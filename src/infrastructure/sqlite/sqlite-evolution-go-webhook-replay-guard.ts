import type { DatabaseSync } from "node:sqlite";
import type {
  EvolutionGoWebhookReplayClaim,
  EvolutionGoWebhookReplayClaimKey,
  EvolutionGoWebhookReplayGuard,
} from "../../channels/whatsapp/evolution-go-webhook-replay-guard.js";
import { tryWithSqliteConnectionLock } from "./sqlite-connection-lock.js";

export class SqliteEvolutionGoWebhookReplayGuard implements EvolutionGoWebhookReplayGuard {
  constructor(private readonly database: DatabaseSync) {}

  claim(input: EvolutionGoWebhookReplayClaim) {
    return tryWithSqliteConnectionLock(this.database, () => {
      this.database.exec("BEGIN IMMEDIATE");
      let transactionStarted = true;
      try {
      const receipt = this.database.prepare(`
        SELECT 1 FROM evolution_go_webhook_receipts
        WHERE business_id = ? AND instance_name = ? AND external_message_id = ?
      `).get(input.businessId, input.instanceName, input.externalMessageId);
      if (receipt) {
        this.database.exec("COMMIT");
        transactionStarted = false;
        return { status: "duplicate" } as const;
      }

      const inserted = this.database.prepare(`
        INSERT OR IGNORE INTO evolution_go_webhook_claims (
          business_id, instance_name, external_message_id, claim_token,
          received_at, claimed_at, lease_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.businessId,
        input.instanceName,
        input.externalMessageId,
        input.claimToken,
        input.receivedAt,
        input.claimedAt,
        input.leaseUntil,
      );
      if (inserted.changes === 1) {
        this.database.exec("COMMIT");
        transactionStarted = false;
        return { status: "claimed", claimToken: input.claimToken } as const;
      }

      const takeover = this.database.prepare(`
        UPDATE evolution_go_webhook_claims
        SET claim_token = ?, claimed_at = ?, lease_until = ?, received_at = ?
        WHERE business_id = ? AND instance_name = ? AND external_message_id = ?
          AND lease_until <= ?
      `).run(
        input.claimToken,
        input.claimedAt,
        input.leaseUntil,
        input.receivedAt,
        input.businessId,
        input.instanceName,
        input.externalMessageId,
        input.claimedAt,
      );
      if (takeover.changes === 1) {
        this.database.exec("COMMIT");
        return { status: "claimed", claimToken: input.claimToken } as const;
      }

      const completedDuringClaim = this.database.prepare(`
        SELECT 1 FROM evolution_go_webhook_receipts
        WHERE business_id = ? AND instance_name = ? AND external_message_id = ?
      `).get(input.businessId, input.instanceName, input.externalMessageId);
      this.database.exec("COMMIT");
      transactionStarted = false;
      return completedDuringClaim
        ? { status: "duplicate" } as const
        : { status: "in_progress" } as const;
    } catch (error) {
      if (transactionStarted) this.database.exec("ROLLBACK");
      throw error;
    }
    });
  }

  complete(input: EvolutionGoWebhookReplayClaimKey): boolean {
    return tryWithSqliteConnectionLock(this.database, () => {
      this.database.exec("BEGIN IMMEDIATE");
      let transactionStarted = true;
      try {
      const receipt = this.database.prepare(`
        INSERT OR IGNORE INTO evolution_go_webhook_receipts (
          business_id, instance_name, external_message_id, received_at
        )
        SELECT business_id, instance_name, external_message_id, received_at
        FROM evolution_go_webhook_claims
        WHERE business_id = ? AND instance_name = ? AND external_message_id = ?
          AND claim_token = ?
      `).run(input.businessId, input.instanceName, input.externalMessageId, input.claimToken);
      if (receipt.changes !== 1) {
        this.database.exec("ROLLBACK");
        transactionStarted = false;
        return false;
      }

      const removed = this.database.prepare(`
        DELETE FROM evolution_go_webhook_claims
        WHERE business_id = ? AND instance_name = ? AND external_message_id = ?
          AND claim_token = ?
      `).run(input.businessId, input.instanceName, input.externalMessageId, input.claimToken);
      if (removed.changes !== 1) {
        this.database.exec("ROLLBACK");
        transactionStarted = false;
        return false;
      }

      this.database.exec("COMMIT");
      transactionStarted = false;
      return true;
    } catch (error) {
      if (transactionStarted) this.database.exec("ROLLBACK");
      throw error;
    }
    });
  }

  release(input: EvolutionGoWebhookReplayClaimKey): boolean {
    return tryWithSqliteConnectionLock(this.database, () => {
    const result = this.database.prepare(`
      DELETE FROM evolution_go_webhook_claims
      WHERE business_id = ? AND instance_name = ? AND external_message_id = ?
        AND claim_token = ?
    `).run(input.businessId, input.instanceName, input.externalMessageId, input.claimToken);
    return result.changes === 1;
    });
  }
}
