import type { PostgresDatabase } from "./postgres-database.js";
import { PaymentWebhookProcessingStatus, type PaymentWebhookClaimResult, type PaymentWebhookEvent, type PaymentWebhookEventRepository } from "../../core/payment-webhook-event.js";

type Row = Record<string, unknown>;

export class PostgresPaymentWebhookEventRepository implements PaymentWebhookEventRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async save(event: PaymentWebhookEvent): Promise<void> {
    await this.database.query(`
      INSERT INTO payment_webhook_events(
        id,business_id,provider,provider_event_id,provider_request_id,resource_id,
        event_type,live_mode,payload_hash,processing_status,received_at,processed_at,error_message
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET
        business_id=excluded.business_id,
        live_mode=excluded.live_mode,
        processing_status=excluded.processing_status,
        processed_at=excluded.processed_at,
        error_message=excluded.error_message
    `, [
      event.id, event.businessId ?? null, event.provider, event.providerEventId ?? null,
      event.providerRequestId ?? null, event.resourceId, event.eventType, event.liveMode ?? null, event.payloadHash,
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

  async claim(event: PaymentWebhookEvent): Promise<PaymentWebhookClaimResult> {
    return this.database.transaction(async (client) => {
      const prior = await client.query<Row>("SELECT * FROM payment_webhook_events WHERE provider=$1 AND provider_event_id=$2 FOR UPDATE", [event.provider, event.providerEventId ?? event.id]);
      const row = prior.rows[0];
      if (row !== undefined) {
        const current = map(row);
        if (current.processingStatus === PaymentWebhookProcessingStatus.PROCESSED || current.processingStatus === PaymentWebhookProcessingStatus.IGNORED) return { status: "duplicate", event: current };
        if (current.processingStatus === PaymentWebhookProcessingStatus.PROCESSING) return { status: "in_progress", event: current };
        await client.query("UPDATE payment_webhook_events SET processing_status='PROCESSING',error_message=NULL,processed_at=NULL,payload_hash=$3,resource_id=$4,event_type=$5,live_mode=$6,provider_request_id=$7 WHERE provider=$1 AND provider_event_id=$2", [event.provider, event.providerEventId ?? event.id, event.payloadHash, event.resourceId, event.eventType, event.liveMode ?? null, event.providerRequestId ?? null]);
        const { errorMessage: _errorMessage, processedAt: _processedAt, liveMode: _liveMode, ...currentWithoutProcessing } = current;
        const eventWithoutProcessing = { ...currentWithoutProcessing, ...event };
        return { status: "claimed", event: { ...eventWithoutProcessing, providerEventId: event.providerEventId ?? event.id, processingStatus: PaymentWebhookProcessingStatus.PROCESSING } };
      }
      const providerEventId = event.providerEventId ?? event.id;
      const inserted = await client.query(`
        INSERT INTO payment_webhook_events(
          id,business_id,provider,provider_event_id,provider_request_id,resource_id,
          event_type,live_mode,payload_hash,processing_status,received_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PROCESSING',$10)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [event.id, event.businessId ?? null, event.provider, providerEventId, event.providerRequestId ?? null, event.resourceId, event.eventType, event.liveMode ?? null, event.payloadHash, event.receivedAt]);
      if (inserted.rowCount === 1) return { status: "claimed", event: { ...event, providerEventId, processingStatus: PaymentWebhookProcessingStatus.PROCESSING } };
      const concurrent = await client.query<Row>("SELECT * FROM payment_webhook_events WHERE provider=$1 AND provider_event_id=$2 FOR UPDATE", [event.provider, providerEventId]);
      const current = concurrent.rows[0] === undefined ? null : map(concurrent.rows[0]);
      if (current?.processingStatus === PaymentWebhookProcessingStatus.PROCESSED || current?.processingStatus === PaymentWebhookProcessingStatus.IGNORED) return { status: "duplicate", event: current };
      if (current?.processingStatus === PaymentWebhookProcessingStatus.PROCESSING) return { status: "in_progress", event: current };
      if (current === null) throw new Error("Unable to claim Mercado Pago webhook event");
      await client.query("UPDATE payment_webhook_events SET processing_status='PROCESSING',error_message=NULL,processed_at=NULL WHERE id=$1", [current.id]);
      return { status: "claimed", event: { ...current, providerEventId, processingStatus: PaymentWebhookProcessingStatus.PROCESSING } };
    });
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
    ...(row.live_mode == null ? {} : { liveMode: row.live_mode === true }),
    payloadHash: String(row.payload_hash),
    processingStatus: processingStatus as PaymentWebhookEvent["processingStatus"],
    receivedAt: dateText(row.received_at),
    ...(row.processed_at == null ? {} : { processedAt: dateText(row.processed_at) }),
    ...(row.error_message == null ? {} : { errorMessage: String(row.error_message) }),
  };
}

function dateText(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
