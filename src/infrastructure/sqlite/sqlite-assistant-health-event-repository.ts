import type { AssistantHealthEvent } from "../../core/domain/entities.js";
import { AssistantHealthEventType, BusinessType, Channel } from "../../core/domain/enums.js";
import type { AssistantHealthEventRepository } from "../../core/repositories.js";
import type { DatabaseSync } from "node:sqlite";

type AssistantHealthEventRow = {
  id: string;
  business_id: string;
  event_type: string;
  conversation_id: string | null;
  opportunity_id: string | null;
  quote_request_id: string | null;
  channel: string | null;
  business_type: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  region: string | null;
  provider: string | null;
  model: string | null;
  reason: string | null;
  occurred_at: string;
};

function mapEnum<T extends string>(values: readonly T[], value: string | null): T | undefined {
  if (value === null) return undefined;
  return values.find((candidate) => candidate === value);
}

export class SqliteAssistantHealthEventRepository implements AssistantHealthEventRepository {
  constructor(private readonly database: DatabaseSync) {}

  async append(event: AssistantHealthEvent): Promise<void> {
    try {
      this.database.prepare(`
        INSERT INTO assistant_health_events (
          id, business_id, event_type, conversation_id, opportunity_id,
          quote_request_id, channel, business_type, country, state, city,
          region, provider, model, reason, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id, event.businessId, event.eventType, event.conversationId ?? null,
        event.opportunityId ?? null, event.quoteRequestId ?? null, event.channel ?? null,
        event.businessType ?? null, event.country ?? null, event.state ?? null,
        event.city ?? null, event.region ?? null, event.provider ?? null,
        event.model ?? null, event.reason ?? null, event.occurredAt,
      );
    } catch {
      throw new Error("Failed to append AssistantHealthEvent");
    }
  }

  async listByBusiness(businessId: string): Promise<AssistantHealthEvent[]> {
    return this.load(`
      SELECT * FROM assistant_health_events
      WHERE business_id = ?
      ORDER BY occurred_at ASC, id ASC
    `, [businessId]);
  }

  async listByConversation(businessId: string, conversationId: string): Promise<AssistantHealthEvent[]> {
    return this.load(`
      SELECT * FROM assistant_health_events
      WHERE business_id = ? AND conversation_id = ?
      ORDER BY occurred_at ASC, id ASC
    `, [businessId, conversationId]);
  }

  private async load(sql: string, parameters: string[]): Promise<AssistantHealthEvent[]> {
    try {
      const rows = this.database.prepare(sql).all(...parameters) as AssistantHealthEventRow[];
      return rows.map((row) => this.toDomain(row));
    } catch {
      throw new Error("Failed to load AssistantHealthEvents");
    }
  }

  private toDomain(row: AssistantHealthEventRow): AssistantHealthEvent {
    const eventType = mapEnum(Object.values(AssistantHealthEventType), row.event_type);
    const channel = mapEnum(Object.values(Channel), row.channel);
    const businessType = mapEnum(Object.values(BusinessType), row.business_type);
    if (eventType === undefined || (row.channel !== null && channel === undefined) ||
      (row.business_type !== null && businessType === undefined)) {
      throw new Error("Invalid AssistantHealthEvent value");
    }
    return {
      id: row.id,
      businessId: row.business_id,
      eventType,
      ...(row.conversation_id !== null ? { conversationId: row.conversation_id } : {}),
      ...(row.opportunity_id !== null ? { opportunityId: row.opportunity_id } : {}),
      ...(row.quote_request_id !== null ? { quoteRequestId: row.quote_request_id } : {}),
      ...(channel !== undefined ? { channel } : {}),
      ...(businessType !== undefined ? { businessType } : {}),
      ...(row.country !== null ? { country: row.country } : {}),
      ...(row.state !== null ? { state: row.state } : {}),
      ...(row.city !== null ? { city: row.city } : {}),
      ...(row.region !== null ? { region: row.region } : {}),
      ...(row.provider !== null ? { provider: row.provider } : {}),
      ...(row.model !== null ? { model: row.model } : {}),
      ...(row.reason !== null ? { reason: row.reason } : {}),
      occurredAt: row.occurred_at,
    };
  }
}
