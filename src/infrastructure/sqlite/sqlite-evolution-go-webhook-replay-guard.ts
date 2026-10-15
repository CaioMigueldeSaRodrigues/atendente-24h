import type { DatabaseSync } from "node:sqlite";
import type {
  EvolutionGoProcessedWebhook,
  EvolutionGoProviderReceipt,
  EvolutionGoWebhookReplayClaim,
  EvolutionGoWebhookReplayClaimKey,
  EvolutionGoWebhookReplayGuard,
} from "../../channels/whatsapp/evolution-go-webhook-replay-guard.js";
import { tryWithSqliteConnectionLock, withSqliteTransaction } from "./sqlite-connection-lock.js";

export class SqliteEvolutionGoWebhookReplayGuard implements EvolutionGoWebhookReplayGuard {
  constructor(private readonly database: DatabaseSync) {}

  claim(input: EvolutionGoWebhookReplayClaim) {
    return tryWithSqliteConnectionLock(this.database, () => {
      this.database.exec("BEGIN IMMEDIATE");
      let transactionStarted = true;
      try {
      const receipt = this.database.prepare(`
        SELECT status, conversation_id, sender_jid, reply
        FROM evolution_go_webhook_receipts
        WHERE business_id = ? AND instance_name = ? AND external_message_id = ?
      `).get(input.businessId, input.instanceName, input.externalMessageId);
      if (receipt) {
        this.database.exec("COMMIT");
        transactionStarted = false;
        const processed = receipt as {
          status: string;
          conversation_id: string | null;
          sender_jid: string | null;
          reply: string | null;
        };
        return processed.status === "processed" &&
            processed.conversation_id !== null &&
            processed.sender_jid !== null &&
            processed.reply !== null
          ? {
              status: "processed",
              processed: {
                conversationId: processed.conversation_id,
                senderJid: processed.sender_jid,
                reply: processed.reply,
              } satisfies EvolutionGoProcessedWebhook,
            } as const
          : { status: "duplicate" } as const;
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

  lockForProcessing(input: EvolutionGoWebhookReplayClaimKey): boolean {
    return tryWithSqliteConnectionLock(this.database, () => Boolean(this.database.prepare(`
      SELECT 1 FROM evolution_go_webhook_claims
      WHERE business_id = ? AND instance_name = ? AND external_message_id = ? AND claim_token = ?
    `).get(input.businessId, input.instanceName, input.externalMessageId, input.claimToken)));
  }

  async markProcessed(input: EvolutionGoWebhookReplayClaimKey & EvolutionGoProcessedWebhook): Promise<boolean> {
    return withSqliteTransaction(this.database, async () => {
        const claim = this.database.prepare(`
          SELECT received_at FROM evolution_go_webhook_claims
          WHERE business_id = ? AND instance_name = ? AND external_message_id = ? AND claim_token = ?
        `).get(input.businessId, input.instanceName, input.externalMessageId, input.claimToken) as
          { received_at: string } | undefined;
        if (!claim) {
          return false;
        }
        const receipt = this.database.prepare(`
          INSERT OR IGNORE INTO evolution_go_webhook_receipts (
            business_id, instance_name, external_message_id, received_at,
            status, conversation_id, sender_jid, reply
          ) VALUES (?, ?, ?, ?, 'processed', ?, ?, ?)
        `).run(
          input.businessId,
          input.instanceName,
          input.externalMessageId,
          claim.received_at,
          input.conversationId,
          input.senderJid,
          input.reply,
        );
        if (receipt.changes !== 1) {
          return false;
        }
        const removed = this.database.prepare(`
          DELETE FROM evolution_go_webhook_claims
          WHERE business_id = ? AND instance_name = ? AND external_message_id = ? AND claim_token = ?
        `).run(input.businessId, input.instanceName, input.externalMessageId, input.claimToken);
        if (removed.changes !== 1) {
          return false;
        }
        return true;
    });
  }

  markSent(input: Omit<EvolutionGoWebhookReplayClaimKey, "claimToken"> & { sentAt: string; providerMessageId?: string }): boolean {
    return tryWithSqliteConnectionLock(this.database, () => {
      const result = this.database.prepare(`
        UPDATE evolution_go_webhook_receipts
        SET status = 'sent', sent_at = ?, provider_message_id = COALESCE(?, provider_message_id),
            provider_status = CASE WHEN ? IS NULL THEN provider_status ELSE 'ACCEPTED_BY_PROVIDER' END,
            provider_accepted_at = CASE WHEN ? IS NULL THEN provider_accepted_at ELSE ? END
        WHERE business_id = ? AND instance_name = ? AND external_message_id = ?
          AND status = 'processed'
      `).run(input.sentAt, input.providerMessageId ?? null, input.providerMessageId ?? null, input.providerMessageId ?? null, input.sentAt, input.businessId, input.instanceName, input.externalMessageId);
      if (result.changes !== 1 || !input.providerMessageId) return result.changes === 1;
      const events = this.database.prepare(`SELECT provider_status, occurred_at FROM evolution_go_delivery_receipts WHERE business_id = ? AND instance_name = ? AND provider_message_id = ? ORDER BY CASE provider_status WHEN 'READ' THEN 2 ELSE 1 END DESC, occurred_at DESC`).all(input.businessId, input.instanceName, input.providerMessageId) as Array<{ provider_status: string; occurred_at: string }>;
      for (const event of events) this.applyProviderStatus(input.businessId, input.instanceName, input.providerMessageId, event.provider_status, event.occurred_at);
      return true;
    });
  }

  applyProviderReceipt(input: EvolutionGoProviderReceipt): boolean {
    return tryWithSqliteConnectionLock(this.database, () => {
      this.database.prepare(`INSERT OR IGNORE INTO evolution_go_delivery_receipts (business_id, instance_name, provider_message_id, provider_status, occurred_at, received_at) VALUES (?, ?, ?, ?, ?, ?)`).run(input.businessId, input.instanceName, input.providerMessageId, input.status, input.occurredAt, new Date().toISOString());
      this.applyProviderStatus(input.businessId, input.instanceName, input.providerMessageId, input.status, input.occurredAt);
      return true;
    });
  }

  private applyProviderStatus(businessId: string, instanceName: string, providerMessageId: string, status: string, occurredAt: string): void {
    this.database.prepare(`UPDATE evolution_go_webhook_receipts SET provider_status = CASE WHEN provider_status='READ' OR (?='DELIVERED' AND provider_status='DELIVERED') THEN provider_status ELSE ? END, delivered_at = CASE WHEN ? IN ('DELIVERED','READ') THEN COALESCE(delivered_at,?) ELSE delivered_at END, read_at = CASE WHEN ?='READ' THEN COALESCE(read_at,?) ELSE read_at END WHERE business_id=? AND instance_name=? AND provider_message_id=?`).run(status, status, status, occurredAt, status, occurredAt, businessId, instanceName, providerMessageId);
  }

  complete(input: EvolutionGoWebhookReplayClaimKey): boolean {
    return tryWithSqliteConnectionLock(this.database, () => {
      this.database.exec("BEGIN IMMEDIATE");
      let transactionStarted = true;
      try {
      const receipt = this.database.prepare(`
        INSERT OR IGNORE INTO evolution_go_webhook_receipts (
          business_id, instance_name, external_message_id, received_at, status, sent_at
        )
        SELECT business_id, instance_name, external_message_id, received_at
          , 'sent', received_at
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
