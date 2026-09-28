import type { DatabaseSync } from "node:sqlite";
import type {
  EvolutionGoWebhookReplayClaim,
  EvolutionGoWebhookReplayGuard,
} from "../../channels/whatsapp/evolution-go-webhook-replay-guard.js";

export class SqliteEvolutionGoWebhookReplayGuard implements EvolutionGoWebhookReplayGuard {
  constructor(private readonly database: DatabaseSync) {}

  claim(input: EvolutionGoWebhookReplayClaim): boolean {
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO evolution_go_webhook_receipts (
        business_id, instance_name, external_message_id, received_at
      ) VALUES (?, ?, ?, ?)
    `).run(
      input.businessId,
      input.instanceName,
      input.externalMessageId,
      input.receivedAt,
    );

    return result.changes === 1;
  }
}
