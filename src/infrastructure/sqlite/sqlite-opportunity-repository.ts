import type { Opportunity } from "../../core/domain/entities.js";
import { OpportunityStatus } from "../../core/domain/enums.js";
import type { Money, NextAction } from "../../core/domain/types.js";
import type { OpportunityRepository } from "../../core/repositories.js";
import type { DatabaseSync } from "node:sqlite";

type OpportunityRow = {
  id: string;
  business_id: string;
  conversation_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  request_description: string | null;
  status: string;
  next_action: string | null;
  estimated_value_amount_cents: number | null;
  estimated_value_currency: string | null;
  realized_value_amount_cents: number | null;
  realized_value_currency: string | null;
  value_source: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

const NEXT_ACTION_TYPES: readonly NextAction["type"][] = [
  "PROVIDE_QUOTE",
  "CALL_CUSTOMER",
  "CONFIRM_AVAILABILITY",
  "SCHEDULE_EVALUATION",
  "REQUEST_INFORMATION",
  "HUMAN_REVIEW",
  "TECHNICAL_REVIEW",
  "NONE",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNextAction(value: unknown): value is NextAction {
  if (!isRecord(value)) return false;
  const validType = NEXT_ACTION_TYPES.some((type) => type === value.type);
  return validType &&
    typeof value.description === "string" &&
    (!Object.hasOwn(value, "dueAt") || typeof value.dueAt === "string") &&
    (!Object.hasOwn(value, "assignedTo") || typeof value.assignedTo === "string");
}

function parseNextAction(value: string | null): NextAction | undefined {
  if (value === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Failed to load Opportunity");
  }

  if (!isNextAction(parsed)) {
    throw new Error("Failed to load Opportunity");
  }

  return {
    type: parsed.type,
    description: parsed.description,
    ...(Object.hasOwn(parsed, "dueAt") ? { dueAt: parsed.dueAt } : {}),
    ...(Object.hasOwn(parsed, "assignedTo")
      ? { assignedTo: parsed.assignedTo }
      : {}),
  };
}

function mapMoney(
  amountCents: number | null,
  currency: string | null,
): Money | undefined {
  if (amountCents === null && currency === null) return undefined;
  if (
    amountCents === null ||
    currency === null ||
    !Number.isSafeInteger(amountCents) ||
    currency !== "BRL"
  ) {
    throw new Error("Failed to load Opportunity");
  }

  return { amountCents, currency };
}

export class SqliteOpportunityRepository implements OpportunityRepository {
  constructor(private readonly database: DatabaseSync) {}

  async save(entity: Opportunity): Promise<void> {
    try {
      this.database.prepare(`
        INSERT INTO opportunities (
          id, business_id, conversation_id, customer_id, vehicle_id,
          request_description, status, next_action,
          estimated_value_amount_cents, estimated_value_currency,
          realized_value_amount_cents, realized_value_currency, value_source,
          created_at, updated_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (business_id, id) DO UPDATE SET
          conversation_id = excluded.conversation_id,
          customer_id = excluded.customer_id,
          vehicle_id = excluded.vehicle_id,
          request_description = excluded.request_description,
          status = excluded.status,
          next_action = excluded.next_action,
          estimated_value_amount_cents = excluded.estimated_value_amount_cents,
          estimated_value_currency = excluded.estimated_value_currency,
          realized_value_amount_cents = excluded.realized_value_amount_cents,
          realized_value_currency = excluded.realized_value_currency,
          value_source = excluded.value_source,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          closed_at = excluded.closed_at
      `).run(
        entity.id,
        entity.businessId,
        entity.conversationId,
        entity.customerId ?? null,
        entity.vehicleId ?? null,
        entity.requestDescription ?? null,
        entity.status,
        entity.nextAction === undefined ? null : JSON.stringify(entity.nextAction),
        entity.estimatedValue?.amountCents ?? null,
        entity.estimatedValue?.currency ?? null,
        entity.realizedValue?.amountCents ?? null,
        entity.realizedValue?.currency ?? null,
        entity.valueSource ?? null,
        entity.createdAt,
        entity.updatedAt,
        entity.closedAt ?? null,
      );
    } catch {
      throw new Error("Failed to save Opportunity");
    }
  }

  async findById(businessId: string, id: string): Promise<Opportunity | null> {
    try {
      const row = this.database.prepare(`
        SELECT * FROM opportunities WHERE business_id = ? AND id = ?
      `).get(businessId, id) as OpportunityRow | undefined;

      return row ? this.toDomain(row) : null;
    } catch {
      throw new Error("Failed to load Opportunity");
    }
  }

  async listByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<Opportunity[]> {
    let rows: OpportunityRow[];
    try {
      rows = this.database.prepare(`
        SELECT * FROM opportunities
        WHERE business_id = ? AND conversation_id = ?
        ORDER BY created_at ASC, id ASC
      `).all(businessId, conversationId) as OpportunityRow[];
    } catch {
      throw new Error("Failed to load Opportunities");
    }

    try {
      return rows.map((row) => this.toDomain(row));
    } catch {
      throw new Error("Failed to load Opportunities");
    }
  }

  private toDomain(row: OpportunityRow): Opportunity {
    const status = Object.values(OpportunityStatus).find(
      (value) => value === row.status,
    );
    if (status === undefined) {
      throw new Error("Failed to load Opportunity");
    }

    const estimatedValue = mapMoney(
      row.estimated_value_amount_cents,
      row.estimated_value_currency,
    );
    const realizedValue = mapMoney(
      row.realized_value_amount_cents,
      row.realized_value_currency,
    );
    const nextAction = parseNextAction(row.next_action);

    return {
      id: row.id,
      businessId: row.business_id,
      conversationId: row.conversation_id,
      ...(row.customer_id !== null ? { customerId: row.customer_id } : {}),
      ...(row.vehicle_id !== null ? { vehicleId: row.vehicle_id } : {}),
      ...(row.request_description !== null
        ? { requestDescription: row.request_description }
        : {}),
      status,
      ...(nextAction !== undefined ? { nextAction } : {}),
      ...(estimatedValue !== undefined ? { estimatedValue } : {}),
      ...(realizedValue !== undefined ? { realizedValue } : {}),
      ...(row.value_source !== null ? { valueSource: row.value_source } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.closed_at !== null ? { closedAt: row.closed_at } : {}),
    };
  }
}
