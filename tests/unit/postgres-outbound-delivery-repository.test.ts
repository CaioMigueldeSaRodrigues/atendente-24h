import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import type { OutboundDelivery } from "../../src/core/domain/entities.js";
import { Channel, OutboundDeliveryStatus } from "../../src/core/domain/enums.js";
import { PostgresOutboundDeliveryRepository } from "../../src/infrastructure/postgres/postgres-repositories.js";
import { PostgresDatabase } from "../../src/infrastructure/postgres/postgres-database.js";

const timestamp = "2026-10-01T12:00:00.000Z";

type Row = Record<string, unknown>;

class FakeDatabase {
  readonly rows = new Map<string, Row>();

  async query<RowType extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []) {
    if (text.startsWith("INSERT INTO outbound_deliveries")) {
      const row = this.rowFromValues(values);
      const key = `${row.business_id}:${row.quote_request_id}:${row.channel}`;
      const created = !this.rows.has(key);
      if (created) this.rows.set(key, row);
      return { rows: [], rowCount: created ? 1 : 0 } as { rows: RowType[]; rowCount: number };
    }
    if (text.startsWith("SELECT * FROM outbound_deliveries WHERE business_id=$1 AND message_id=$2")) {
      const row = [...this.rows.values()].find((candidate) => candidate.business_id === values[0] && candidate.message_id === values[1] && candidate.channel === values[2]);
      return { rows: row ? [row as RowType] : [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith("SELECT * FROM outbound_deliveries WHERE business_id=$1 AND quote_request_id=$2")) {
      const row = [...this.rows.values()].find((candidate) => candidate.business_id === values[0] && candidate.quote_request_id === values[1] && candidate.channel === values[2]);
      return { rows: row ? [row as RowType] : [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith("SELECT * FROM outbound_deliveries WHERE business_id=$1 AND id=$2")) {
      const row = [...this.rows.values()].find((candidate) => candidate.business_id === values[0] && candidate.id === values[1]);
      return { rows: row ? [row as RowType] : [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith("UPDATE outbound_deliveries SET status=$1,attempts")) {
      const row = [...this.rows.values()].find((candidate) => candidate.business_id === values[4] && candidate.id === values[5]);
      if (!row || !(
        row.status === OutboundDeliveryStatus.PENDING ||
        (row.status === OutboundDeliveryStatus.FAILED_RETRYABLE &&
          (row.next_attempt_at === null || String(row.next_attempt_at) <= String(values[1]))) ||
        (row.status === OutboundDeliveryStatus.SENDING && row.lease_until !== null && String(row.lease_until) <= String(values[1]))
      )) return { rows: [], rowCount: 0 } as { rows: RowType[]; rowCount: number };
      row.status = values[0];
      row.attempts = Number(row.attempts) + 1;
      row.updated_at = values[1]; row.claimed_at = values[1]; row.lease_until = values[2]; row.claim_token = values[3];
      return { rows: [row as RowType], rowCount: 1 } as { rows: RowType[]; rowCount: number };
    }
    if (text.startsWith("UPDATE outbound_deliveries SET status=$1,delivered_at")) {
      const row = [...this.rows.values()].find((candidate) => candidate.business_id === values[4] && candidate.id === values[5]);
      if (!row || row.status !== OutboundDeliveryStatus.SENDING || row.claim_token !== values[7]) return { rows: [], rowCount: 0 } as { rows: RowType[]; rowCount: number };
      row.status = values[0];
      row.delivered_at = values[1];
      row.updated_at = values[2];
      row.provider_message_id = values[3];
      row.last_error = null;
      row.next_attempt_at = null;
      row.claimed_at = null; row.lease_until = null; row.claim_token = null;
      return { rows: [row as RowType], rowCount: 1 } as { rows: RowType[]; rowCount: number };
    }
    if (text.startsWith("UPDATE outbound_deliveries SET status=$1,last_error")) {
      const row = [...this.rows.values()].find((candidate) => candidate.business_id === values[4] && candidate.id === values[5]);
      if (!row || row.status !== OutboundDeliveryStatus.SENDING || row.claim_token !== values[7]) return { rows: [], rowCount: 0 } as { rows: RowType[]; rowCount: number };
      row.status = values[0];
      row.last_error = values[1];
      row.next_attempt_at = values[2];
      row.updated_at = values[3];
      row.claimed_at = null; row.lease_until = null; row.claim_token = null;
      return { rows: [row as RowType], rowCount: 1 } as { rows: RowType[]; rowCount: number };
    }
    throw new Error(`Unexpected fake SQL: ${text}`);
  }

  private rowFromValues(values: readonly unknown[]): Row {
    return {
      id: values[0], business_id: values[1], message_id: values[2], quote_request_id: values[3],
      conversation_id: values[4], channel: values[5], recipient_ref: values[6], status: values[7],
      attempts: values[8], last_error: values[9], provider_message_id: values[10], next_attempt_at: values[11],
      created_at: values[12], updated_at: values[13], delivered_at: values[14], claimed_at: values[15], lease_until: values[16], claim_token: values[17],
    };
  }
}

function delivery(overrides: Partial<OutboundDelivery> = {}): OutboundDelivery {
  return {
    id: "delivery-a", businessId: "business-a", messageId: "message-a", quoteRequestId: "quote-a",
    conversationId: "conversation-a", channel: Channel.WHATSAPP, recipientRef: "jid@s.whatsapp.net",
    status: OutboundDeliveryStatus.PENDING, attempts: 0, createdAt: timestamp, updatedAt: timestamp,
    ...overrides,
  };
}

test("PostgreSQL adapter maps the outbox and keeps the message/channel key idempotent", async () => {
  const fake = new FakeDatabase();
  const repository = new PostgresOutboundDeliveryRepository(fake as unknown as PostgresDatabase);
  const first = await repository.create(delivery());
  const duplicate = await repository.create(delivery({ id: "different-id" }));
  assert.deepEqual(duplicate, first);
  const claim = await repository.claimForSending("business-a", "delivery-a", "2026-10-01T12:01:00.000Z", "2026-10-01T12:02:00.000Z", "claim-a");
  assert.equal(claim.claimed, true);
  assert.equal(claim.delivery.attempts, 1);
  const delivered = await repository.markDelivered(
    "business-a", "delivery-a", "2026-10-01T12:01:01.000Z", "2026-10-01T12:01:01.000Z", "claim-a",
  );
  assert.equal(delivered.status, OutboundDeliveryStatus.DELIVERED);
  assert.equal((await repository.claimForSending("business-a", "delivery-a", "2026-10-01T12:02:00.000Z", "2026-10-01T12:03:00.000Z", "claim-b")).claimed, false);
});
