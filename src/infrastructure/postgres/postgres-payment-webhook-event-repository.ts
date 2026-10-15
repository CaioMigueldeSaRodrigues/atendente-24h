import type { PostgresDatabase } from "./postgres-database.js";
import { PaymentWebhookProcessingStatus, type PaymentWebhookEvent, type PaymentWebhookEventRepository } from "../../core/payment-webhook-event.js";

type Row = Record<string, unknown>;

export class PostgresPaymentWebhookEventRepository implements PaymentWebhookEventRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async save(event: PaymentWebhookEvent): Promise<void> {
    await this.database.query(`
      INSERT INTO payment_webhook_events(
        id,business_id,provider,provider_event_id,provider_request_id,resource_id,
        event_type,payload_hash,processing_status,received_at,processed_at,error_message
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        business_id=excluded.business_id,
        processing_status=excluded.processing_status,
        processed_at=excluded.processed_at,
        error_message=excluded.error_message
    `, [
      event.id, event.businessId ?? null, event.provider, event.providerEventId ?? null,
      event.providerRequestId ?? null, event.resourceId, event.eventType, event.payloadHash,
      event.processingStatus, event.receivedAt, event.processedAt ?? null, event.errorMessage ?? null,
    ]);
  }

  async findByProviderEventId(provider: string, providerEventId: string): Promise<PaymentWebhookEvent | null> {
    const result = await this.database.query<Row>("SELECT * FROM payment_webhook_events WHERE provider=$1 AND provider_event_id=$2", [provider, providerEventId]);
    return result.rows[0] === undefined ? null : map(result.rows[0]);
  }

  async update(event: PaymentWebhookEvent): Promise<void> {
    await this.save(event);
  }
}

function map(row: Row): PaymentWebhookEvent {
  const processingStatus = String(row.processing_status);
  if (!Object.values(PaymentWebhookProcessingStatus).includes(processingStatus as PaymentWebhookEvent["processingStatus"])) throw new Error("Invalid persisted payment webhook status");
  return {
    id: String(row.id),
    ...(row.business_id == null ? {} : { businessId: String(row.business_id) }),
    provider: String(row.provider),
    ...(row.provider_event_id == null ? {} : { providerEventId: String(row.provider_event_id) }),
    ...(row.provider_request_id == null ? {} : { providerRequestId: String(row.provider_request_id) }),
    resourceId: String(row.resource_id),
    eventType: String(row.event_type),
    payloadHash: String(row.payload_hash),
    processingStatus: processingStatus as PaymentWebhookEvent["processingStatus"],
    receivedAt: dateText(row.received_at),
    ...(row.processed_at == null ? {} : { processedAt: dateText(row.processed_at) }),
    ...(row.error_message == null ? {} : { errorMessage: String(row.error_message) }),
  };
}

function dateText(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
