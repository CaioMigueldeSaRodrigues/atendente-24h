import type { Conversation } from "../../core/domain/entities.js";
import {
  Channel,
  CommercialOutcome,
  ConversationStatus,
  Intent,
} from "../../core/domain/enums.js";
import type { ConversationRepository } from "../../core/repositories.js";
import type { DatabaseSync } from "node:sqlite";

type ConversationRow = {
  id: string;
  business_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  channel: string;
  status: string;
  commercial_outcome: string | null;
  current_intent: string | null;
  started_at: string;
  last_message_at: string;
  closed_at: string | null;
};

export class SqliteConversationRepository implements ConversationRepository {
  constructor(private readonly database: DatabaseSync) {}

  async save(entity: Conversation): Promise<void> {
    try {
      this.database.prepare(`
        INSERT INTO conversations (
          id, business_id, customer_id, vehicle_id, channel, status,
          commercial_outcome, current_intent, started_at, last_message_at,
          closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (business_id, id) DO UPDATE SET
          customer_id = excluded.customer_id,
          vehicle_id = excluded.vehicle_id,
          channel = excluded.channel,
          status = excluded.status,
          commercial_outcome = excluded.commercial_outcome,
          current_intent = excluded.current_intent,
          started_at = excluded.started_at,
          last_message_at = excluded.last_message_at,
          closed_at = excluded.closed_at
      `).run(
        entity.id,
        entity.businessId,
        entity.customerId ?? null,
        entity.vehicleId ?? null,
        entity.channel,
        entity.status,
        entity.commercialOutcome ?? null,
        entity.currentIntent ?? null,
        entity.startedAt,
        entity.lastMessageAt,
        entity.closedAt ?? null,
      );
    } catch {
      throw new Error("Failed to save Conversation");
    }
  }

  async findById(businessId: string, id: string): Promise<Conversation | null> {
    try {
      const row = this.database.prepare(`
        SELECT * FROM conversations WHERE business_id = ? AND id = ?
      `).get(businessId, id) as ConversationRow | undefined;

      return row ? this.toDomain(row) : null;
    } catch {
      throw new Error("Failed to load Conversation");
    }
  }

  private toDomain(row: ConversationRow): Conversation {
    const channel = Object.values(Channel).find((value) => value === row.channel);
    const status = Object.values(ConversationStatus).find(
      (value) => value === row.status,
    );
    const commercialOutcome = row.commercial_outcome === null
      ? undefined
      : Object.values(CommercialOutcome).find(
        (value) => value === row.commercial_outcome,
      );
    const currentIntent = row.current_intent === null
      ? undefined
      : Object.values(Intent).find((value) => value === row.current_intent);

    if (
      channel === undefined ||
      status === undefined ||
      (row.commercial_outcome !== null && commercialOutcome === undefined) ||
      (row.current_intent !== null && currentIntent === undefined)
    ) {
      throw new Error("Failed to load Conversation");
    }

    return {
      id: row.id,
      businessId: row.business_id,
      ...(row.customer_id !== null ? { customerId: row.customer_id } : {}),
      ...(row.vehicle_id !== null ? { vehicleId: row.vehicle_id } : {}),
      channel,
      status,
      ...(commercialOutcome !== undefined ? { commercialOutcome } : {}),
      ...(currentIntent !== undefined ? { currentIntent } : {}),
      startedAt: row.started_at,
      lastMessageAt: row.last_message_at,
      ...(row.closed_at !== null ? { closedAt: row.closed_at } : {}),
    };
  }
}
