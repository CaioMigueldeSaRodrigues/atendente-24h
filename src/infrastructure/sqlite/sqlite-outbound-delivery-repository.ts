import type { DatabaseSync } from "node:sqlite";
import type { OutboundDelivery } from "../../core/domain/entities.js";
import { Channel, OutboundDeliveryStatus } from "../../core/domain/enums.js";
import type { OutboundDeliveryClaimResult, OutboundDeliveryFailure, OutboundDeliveryRepository, OutboundDeliveryReservation } from "../../core/repositories.js";
import { withSqliteConnectionLock } from "./sqlite-connection-lock.js";

type OutboundDeliveryRow = {
  id: string; business_id: string; message_id: string | null; quote_request_id: string; conversation_id: string; channel: string;
  recipient_ref: string | null; status: string; attempts: number; last_error: string | null; provider_message_id: string | null;
  next_attempt_at: string | null; created_at: string; updated_at: string; delivered_at: string | null;
  claimed_at: string | null; lease_until: string | null; claim_token: string | null;
};

export class SqliteOutboundDeliveryRepository implements OutboundDeliveryRepository {
  constructor(private readonly database: DatabaseSync) {}
  async findById(businessId: string, id: string): Promise<OutboundDelivery | null> { return this.read("SELECT * FROM outbound_deliveries WHERE business_id = ? AND id = ?", businessId, id); }
  async findByMessageAndChannel(businessId: string, messageId: string, channel: OutboundDelivery["channel"]): Promise<OutboundDelivery | null> { return this.read("SELECT * FROM outbound_deliveries WHERE business_id = ? AND message_id = ? AND channel = ?", businessId, messageId, channel); }
  async findByQuoteRequestAndChannel(businessId: string, quoteRequestId: string, channel: OutboundDelivery["channel"]): Promise<OutboundDelivery | null> { return this.read("SELECT * FROM outbound_deliveries WHERE business_id = ? AND quote_request_id = ? AND channel = ?", businessId, quoteRequestId, channel); }

  async create(entity: OutboundDelivery): Promise<OutboundDelivery> { return (await this.reserve(entity)).delivery; }
  async reserve(entity: OutboundDelivery): Promise<OutboundDeliveryReservation> {
    try {
      return await withSqliteConnectionLock(this.database, () => {
        const result = this.database.prepare(`INSERT INTO outbound_deliveries
          (id,business_id,message_id,quote_request_id,conversation_id,channel,recipient_ref,status,attempts,last_error,provider_message_id,next_attempt_at,created_at,updated_at,delivered_at,claimed_at,lease_until,claim_token)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT (business_id,quote_request_id,channel) DO NOTHING`).run(
          entity.id, entity.businessId, entity.messageId ?? null, entity.quoteRequestId, entity.conversationId, entity.channel,
          entity.recipientRef ?? null, entity.status, entity.attempts, entity.lastError ?? null, entity.providerMessageId ?? null,
          entity.nextAttemptAt ?? null, entity.createdAt, entity.updatedAt, entity.deliveredAt ?? null, entity.claimedAt ?? null,
          entity.leaseUntil ?? null, entity.claimToken ?? null,
        );
        const row = this.database.prepare("SELECT * FROM outbound_deliveries WHERE business_id = ? AND quote_request_id = ? AND channel = ?").get(entity.businessId, entity.quoteRequestId, entity.channel) as OutboundDeliveryRow | undefined;
        if (!row) throw new Error("OutboundDelivery was not created");
        return { created: result.changes === 1, delivery: this.toDomain(row) };
      });
    } catch (error) { if (error instanceof Error && error.message === "OutboundDelivery was not created") throw error; throw new Error("Failed to create OutboundDelivery"); }
  }

  async attachMessage(businessId: string, id: string, messageId: string, updatedAt: string): Promise<OutboundDelivery> {
    try {
      return await withSqliteConnectionLock(this.database, () => {
        const result = this.database.prepare("UPDATE outbound_deliveries SET message_id = ?, updated_at = ? WHERE business_id = ? AND id = ? AND message_id IS NULL").run(messageId, updatedAt, businessId, id);
        const row = this.database.prepare("SELECT * FROM outbound_deliveries WHERE business_id = ? AND id = ?").get(businessId, id) as OutboundDeliveryRow | undefined;
        if (!row) throw new Error("OutboundDelivery not found");
        if (result.changes !== 1 && row.message_id !== messageId) throw new Error("OutboundDelivery message is already attached");
        return this.toDomain(row);
      });
    } catch (error) { if (error instanceof Error && /OutboundDelivery (not found|message is already attached)/.test(error.message)) throw error; throw new Error("Failed to attach OutboundDelivery message"); }
  }

  async claimForSending(businessId: string, id: string, now: string, leaseUntil: string, claimToken: string): Promise<OutboundDeliveryClaimResult> {
    try {
      return await withSqliteConnectionLock(this.database, () => {
        const result = this.database.prepare(`UPDATE outbound_deliveries SET status = ?, attempts = attempts + 1, updated_at = ?, claimed_at = ?, lease_until = ?, claim_token = ?
          WHERE business_id = ? AND id = ? AND (status = ? OR (status = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = ? AND lease_until IS NOT NULL AND lease_until <= ?))`).run(
          OutboundDeliveryStatus.SENDING, now, now, leaseUntil, claimToken, businessId, id, OutboundDeliveryStatus.PENDING,
          OutboundDeliveryStatus.FAILED_RETRYABLE, now, OutboundDeliveryStatus.SENDING, now,
        );
        const row = this.database.prepare("SELECT * FROM outbound_deliveries WHERE business_id = ? AND id = ?").get(businessId, id) as OutboundDeliveryRow | undefined;
        if (!row) throw new Error("OutboundDelivery not found");
        return { claimed: result.changes === 1, delivery: this.toDomain(row) };
      });
    } catch (error) { if (error instanceof Error && error.message === "OutboundDelivery not found") throw error; throw new Error("Failed to claim OutboundDelivery"); }
  }

  async markDelivered(businessId: string, id: string, deliveredAt: string, updatedAt: string, claimToken: string, providerMessageId?: string): Promise<OutboundDelivery> {
    try {
      return await withSqliteConnectionLock(this.database, () => {
        const result = this.database.prepare(`UPDATE outbound_deliveries SET status = ?, delivered_at = ?, updated_at = ?, provider_message_id = ?, last_error = NULL, next_attempt_at = NULL, claimed_at = NULL, lease_until = NULL, claim_token = NULL
          WHERE business_id = ? AND id = ? AND status = ? AND claim_token = ?`).run(
          OutboundDeliveryStatus.DELIVERED, deliveredAt, updatedAt, providerMessageId ?? null, businessId, id, OutboundDeliveryStatus.SENDING, claimToken,
        );
        if (result.changes !== 1) throw new Error("OutboundDelivery is not owned by claim");
        return this.requireInLock(businessId, id);
      });
    } catch (error) { if (error instanceof Error && error.message === "OutboundDelivery is not owned by claim") throw error; throw new Error("Failed to mark OutboundDelivery as delivered"); }
  }

  async markFailed(businessId: string, id: string, failure: OutboundDeliveryFailure, claimToken: string): Promise<OutboundDelivery> {
    try {
      return await withSqliteConnectionLock(this.database, () => {
        const result = this.database.prepare(`UPDATE outbound_deliveries SET status = ?, last_error = ?, next_attempt_at = ?, updated_at = ?, claimed_at = NULL, lease_until = NULL, claim_token = NULL
          WHERE business_id = ? AND id = ? AND status = ? AND claim_token = ?`).run(
          failure.status, failure.lastError, failure.nextAttemptAt ?? null, failure.updatedAt, businessId, id, OutboundDeliveryStatus.SENDING, claimToken,
        );
        if (result.changes !== 1) throw new Error("OutboundDelivery is not owned by claim");
        return this.requireInLock(businessId, id);
      });
    } catch (error) { if (error instanceof Error && error.message === "OutboundDelivery is not owned by claim") throw error; throw new Error("Failed to mark OutboundDelivery as failed"); }
  }

  private async read(sql: string, ...params: any[]): Promise<OutboundDelivery | null> {
    try { return await withSqliteConnectionLock(this.database, () => { const row = this.database.prepare(sql).get(...params) as OutboundDeliveryRow | undefined; return row ? this.toDomain(row) : null; }); }
    catch { throw new Error("Failed to load OutboundDelivery"); }
  }
  private requireInLock(businessId: string, id: string): OutboundDelivery {
    const row = this.database.prepare("SELECT * FROM outbound_deliveries WHERE business_id = ? AND id = ?").get(businessId, id) as OutboundDeliveryRow | undefined;
    if (!row) throw new Error("OutboundDelivery not found");
    return this.toDomain(row);
  }
  private toDomain(row: OutboundDeliveryRow): OutboundDelivery {
    const channel = Object.values(Channel).find((value) => value === row.channel);
    const status = Object.values(OutboundDeliveryStatus).find((value) => value === row.status);
    if (channel === undefined || status === undefined || !Number.isSafeInteger(row.attempts) || row.attempts < 0) throw new Error("Failed to load OutboundDelivery");
    return { id: row.id, businessId: row.business_id, ...(row.message_id === null ? {} : { messageId: row.message_id }), quoteRequestId: row.quote_request_id, conversationId: row.conversation_id, channel,
      ...(row.recipient_ref !== null ? { recipientRef: row.recipient_ref } : {}), status, attempts: row.attempts,
      ...(row.last_error !== null ? { lastError: row.last_error } : {}), ...(row.provider_message_id !== null ? { providerMessageId: row.provider_message_id } : {}),
      ...(row.next_attempt_at !== null ? { nextAttemptAt: row.next_attempt_at } : {}), createdAt: row.created_at, updatedAt: row.updated_at,
      ...(row.delivered_at !== null ? { deliveredAt: row.delivered_at } : {}), ...(row.claimed_at !== null ? { claimedAt: row.claimed_at } : {}),
      ...(row.lease_until !== null ? { leaseUntil: row.lease_until } : {}), ...(row.claim_token !== null ? { claimToken: row.claim_token } : {}) };
  }
}
