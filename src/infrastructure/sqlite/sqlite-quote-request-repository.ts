import type { QuoteRequest } from "../../core/domain/entities.js";
import { QuoteRequestStatus } from "../../core/domain/enums.js";
import type { Money } from "../../core/domain/types.js";
import type { QuoteRequestRepository } from "../../core/repositories.js";
import type { DatabaseSync } from "node:sqlite";

type QuoteRequestRow = {
  id: string;
  business_id: string;
  opportunity_id: string;
  conversation_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  request_description: string;
  symptom_description: string | null;
  status: string;
  requested_at: string;
  responded_at: string | null;
  authorized_price_amount_cents: number | null;
  authorized_price_currency: string | null;
  created_at: string;
  updated_at: string;
};

function mapAuthorizedPrice(
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
    throw new Error("Failed to load QuoteRequest");
  }

  return { amountCents, currency };
}

export class SqliteQuoteRequestRepository implements QuoteRequestRepository {
  constructor(private readonly database: DatabaseSync) {}

  async save(entity: QuoteRequest): Promise<void> {
    try {
      this.database.prepare(`
        INSERT INTO quote_requests (
          id, business_id, opportunity_id, conversation_id, customer_id,
          vehicle_id, request_description, symptom_description, status,
          requested_at, responded_at, authorized_price_amount_cents,
          authorized_price_currency, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (business_id, id) DO UPDATE SET
          opportunity_id = excluded.opportunity_id,
          conversation_id = excluded.conversation_id,
          customer_id = excluded.customer_id,
          vehicle_id = excluded.vehicle_id,
          request_description = excluded.request_description,
          symptom_description = excluded.symptom_description,
          status = excluded.status,
          requested_at = excluded.requested_at,
          responded_at = excluded.responded_at,
          authorized_price_amount_cents = excluded.authorized_price_amount_cents,
          authorized_price_currency = excluded.authorized_price_currency,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `).run(
        entity.id,
        entity.businessId,
        entity.opportunityId,
        entity.conversationId,
        entity.customerId ?? null,
        entity.vehicleId ?? null,
        entity.requestDescription,
        entity.symptomDescription ?? null,
        entity.status,
        entity.requestedAt,
        entity.respondedAt ?? null,
        entity.authorizedPrice?.amountCents ?? null,
        entity.authorizedPrice?.currency ?? null,
        entity.createdAt,
        entity.updatedAt,
      );
    } catch {
      throw new Error("Failed to save QuoteRequest");
    }
  }

  async findById(businessId: string, id: string): Promise<QuoteRequest | null> {
    try {
      const row = this.database.prepare(`
        SELECT * FROM quote_requests WHERE business_id = ? AND id = ?
      `).get(businessId, id) as QuoteRequestRow | undefined;

      return row ? this.toDomain(row) : null;
    } catch {
      throw new Error("Failed to load QuoteRequest");
    }
  }

  async listByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<QuoteRequest[]> {
    let rows: QuoteRequestRow[];
    try {
      rows = this.database.prepare(`
        SELECT * FROM quote_requests
        WHERE business_id = ? AND conversation_id = ?
        ORDER BY requested_at ASC, id ASC
      `).all(businessId, conversationId) as QuoteRequestRow[];
    } catch {
      throw new Error("Failed to load QuoteRequests");
    }

    try {
      return rows.map((row) => this.toDomain(row));
    } catch {
      throw new Error("Failed to load QuoteRequests");
    }
  }

  private toDomain(row: QuoteRequestRow): QuoteRequest {
    const status = Object.values(QuoteRequestStatus).find(
      (value) => value === row.status,
    );
    if (status === undefined) {
      throw new Error("Failed to load QuoteRequest");
    }

    const authorizedPrice = mapAuthorizedPrice(
      row.authorized_price_amount_cents,
      row.authorized_price_currency,
    );

    return {
      id: row.id,
      businessId: row.business_id,
      opportunityId: row.opportunity_id,
      conversationId: row.conversation_id,
      ...(row.customer_id !== null ? { customerId: row.customer_id } : {}),
      ...(row.vehicle_id !== null ? { vehicleId: row.vehicle_id } : {}),
      requestDescription: row.request_description,
      ...(row.symptom_description !== null
        ? { symptomDescription: row.symptom_description }
        : {}),
      status,
      requestedAt: row.requested_at,
      ...(row.responded_at !== null ? { respondedAt: row.responded_at } : {}),
      ...(authorizedPrice !== undefined ? { authorizedPrice } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
