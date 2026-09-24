import type { CommercialEvent } from "../../core/domain/entities.js";
import {
  BusinessType,
  Channel,
  CommercialEventType,
  CommercialOutcome,
  Intent,
} from "../../core/domain/enums.js";
import type { Money } from "../../core/domain/types.js";
import type { CommercialEventRepository } from "../../core/repositories.js";
import type { DatabaseSync } from "node:sqlite";

type CommercialEventRow = {
  id: string;
  business_id: string;
  event_type: string;
  conversation_id: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  opportunity_id: string | null;
  quote_request_id: string | null;
  channel: string | null;
  intent: string | null;
  commercial_outcome: string | null;
  business_type: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  region: string | null;
  category: string | null;
  requested_item: string | null;
  symptom: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  amount_cents: number | null;
  currency: string | null;
  occurred_at: string;
};

function mapEnum<T extends string>(values: readonly T[], value: string | null): T | undefined {
  if (value === null) return undefined;
  return values.find((candidate) => candidate === value);
}

function mapMoney(amountCents: number | null, currency: string | null): Money | undefined {
  if (amountCents === null && currency === null) return undefined;
  if (amountCents === null || currency === null || !Number.isSafeInteger(amountCents) || amountCents < 0 || currency !== "BRL") {
    throw new Error("Invalid CommercialEvent money");
  }
  return { amountCents, currency };
}

function validateMoney(amount: Money | undefined): void {
  if (amount !== undefined && (!Number.isSafeInteger(amount.amountCents) || amount.amountCents < 0 || amount.currency !== "BRL")) {
    throw new Error("Invalid CommercialEvent money");
  }
}

export class SqliteCommercialEventRepository implements CommercialEventRepository {
  constructor(private readonly database: DatabaseSync) {}

  async append(event: CommercialEvent): Promise<void> {
    try {
      validateMoney(event.amount);
      this.database.prepare(`
        INSERT INTO commercial_events (
          id, business_id, event_type, conversation_id, customer_id, vehicle_id,
          opportunity_id, quote_request_id, channel, intent, commercial_outcome,
          business_type, country, state, city, region, category, requested_item,
          symptom, vehicle_brand, vehicle_model, vehicle_year, amount_cents,
          currency, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id, event.businessId, event.eventType, event.conversationId ?? null,
        event.customerId ?? null, event.vehicleId ?? null, event.opportunityId ?? null,
        event.quoteRequestId ?? null, event.channel ?? null, event.intent ?? null,
        event.commercialOutcome ?? null, event.businessType ?? null, event.country ?? null,
        event.state ?? null, event.city ?? null, event.region ?? null, event.category ?? null,
        event.requestedItem ?? null, event.symptom ?? null, event.vehicleBrand ?? null,
        event.vehicleModel ?? null, event.vehicleYear ?? null, event.amount?.amountCents ?? null,
        event.amount?.currency ?? null, event.occurredAt,
      );
    } catch {
      throw new Error("Failed to append CommercialEvent");
    }
  }

  async listByBusiness(businessId: string): Promise<CommercialEvent[]> {
    return this.load(`
      SELECT * FROM commercial_events
      WHERE business_id = ?
      ORDER BY occurred_at ASC, id ASC
    `, [businessId]);
  }

  async listByConversation(businessId: string, conversationId: string): Promise<CommercialEvent[]> {
    return this.load(`
      SELECT * FROM commercial_events
      WHERE business_id = ? AND conversation_id = ?
      ORDER BY occurred_at ASC, id ASC
    `, [businessId, conversationId]);
  }

  private async load(sql: string, parameters: string[]): Promise<CommercialEvent[]> {
    try {
      const rows = this.database.prepare(sql).all(...parameters) as CommercialEventRow[];
      return rows.map((row) => this.toDomain(row));
    } catch {
      throw new Error("Failed to load CommercialEvents");
    }
  }

  private toDomain(row: CommercialEventRow): CommercialEvent {
    const eventType = mapEnum(Object.values(CommercialEventType), row.event_type);
    const channel = mapEnum(Object.values(Channel), row.channel);
    const intent = mapEnum(Object.values(Intent), row.intent);
    const commercialOutcome = mapEnum(Object.values(CommercialOutcome), row.commercial_outcome);
    const businessType = mapEnum(Object.values(BusinessType), row.business_type);
    const amount = mapMoney(row.amount_cents, row.currency);
    if (eventType === undefined || (row.channel !== null && channel === undefined) ||
      (row.intent !== null && intent === undefined) ||
      (row.commercial_outcome !== null && commercialOutcome === undefined) ||
      (row.business_type !== null && businessType === undefined)) {
      throw new Error("Invalid CommercialEvent value");
    }
    return {
      id: row.id,
      businessId: row.business_id,
      eventType,
      ...(row.conversation_id !== null ? { conversationId: row.conversation_id } : {}),
      ...(row.customer_id !== null ? { customerId: row.customer_id } : {}),
      ...(row.vehicle_id !== null ? { vehicleId: row.vehicle_id } : {}),
      ...(row.opportunity_id !== null ? { opportunityId: row.opportunity_id } : {}),
      ...(row.quote_request_id !== null ? { quoteRequestId: row.quote_request_id } : {}),
      ...(channel !== undefined ? { channel } : {}),
      ...(intent !== undefined ? { intent } : {}),
      ...(commercialOutcome !== undefined ? { commercialOutcome } : {}),
      ...(businessType !== undefined ? { businessType } : {}),
      ...(row.country !== null ? { country: row.country } : {}),
      ...(row.state !== null ? { state: row.state } : {}),
      ...(row.city !== null ? { city: row.city } : {}),
      ...(row.region !== null ? { region: row.region } : {}),
      ...(row.category !== null ? { category: row.category } : {}),
      ...(row.requested_item !== null ? { requestedItem: row.requested_item } : {}),
      ...(row.symptom !== null ? { symptom: row.symptom } : {}),
      ...(row.vehicle_brand !== null ? { vehicleBrand: row.vehicle_brand } : {}),
      ...(row.vehicle_model !== null ? { vehicleModel: row.vehicle_model } : {}),
      ...(row.vehicle_year !== null ? { vehicleYear: row.vehicle_year } : {}),
      ...(amount !== undefined ? { amount } : {}),
      occurredAt: row.occurred_at,
    };
  }
}
