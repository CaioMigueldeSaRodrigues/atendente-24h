import assert from "node:assert/strict";
import test from "node:test";
import type { PostgresDatabase } from "../../src/infrastructure/postgres/postgres-database.js";
import { PostgresAmpliviewAdminReadModel } from "../../src/infrastructure/postgres/postgres-ampliview-admin-read-model.js";
import { Channel, CommercialEventType } from "../../src/core/domain/enums.js";

test("PostgreSQL administrative read model keeps tenant parameters and maps overview aggregates", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const fakeDatabase = {
    async query(text: string, values: readonly unknown[]) {
      calls.push({ text, values });
      if (text.includes("AS total")) return { rows: [{ total: "1" }] };
      if (text.includes("ranked_quotes")) return { rows: [{ conversation_id: "conversation-a", started_at: "2026-01-01T00:00:00.000Z", last_message_at: "2026-01-01T00:01:00.000Z", channel: "WHATSAPP", conversation_status: "ACTIVE", current_intent: null, commercial_outcome: null, customer_id: null, vehicle_id: null, opportunity_id: null, quote_id: null, delivery_id: null, last_sender_type: null }] };
      if (text.includes("FROM conversations")) return { rows: [{ conversations: "2", customers: "2", vehicles: "2" }] };
      if (text.includes("FROM scoped")) return { rows: [{ quote_requests: "2", quote_responded: "1", authorized_total: "65000", authorized_average: "65000", request_response_ms: "3600000" }] };
      if (text.includes("JOIN outbound_deliveries")) return { rows: [{ publish_delivery_ms: "300000" }] };
      if (text.includes("FROM outbound_deliveries")) return { rows: [{ delivered: "1", pending: "0", failed: "1" }] };
      return { rows: [{ quote_published: "1", response_publish_ms: "1800000" }] };
    },
  } as unknown as PostgresDatabase;

  const overview = await new PostgresAmpliviewAdminReadModel(fakeDatabase).getOverview({
    businessId: "business-a",
    period: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-03T00:00:00.000Z" },
  });
  assert.equal(overview.conversations, 2);
  assert.equal(overview.quoteRequests, 2);
  assert.equal(overview.quotePublished, 1);
  assert.equal(overview.deliveriesDelivered, 1);
  assert.equal(overview.deliveriesFailed, 1);
  assert.equal(overview.authorizedValueTotal.amountCents, 65000);
  assert.equal(overview.averageRequestToResponseMs, 3600000);
  assert.equal(overview.averageResponseToPublishMs, 1800000);
  assert.equal(overview.averagePublishToDeliveryMs, 300000);
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.match(call.text, /business_id\s*=\s*\$\d+/);
    assert.ok(call.values.includes("business-a"));
  }

  const list = await new PostgresAmpliviewAdminReadModel(fakeDatabase).listConversations({ businessId: "business-a", page: 1, pageSize: 25 });
  assert.equal(list.total, 1);
  assert.equal(list.items[0]?.conversationId, "conversation-a");
  assert.equal(calls.length, 7);
  assert.ok(calls[5]?.values.includes("business-a"));
  assert.ok(calls[6]?.values.includes("business-a"));
});

test("PostgreSQL demand query keeps tenant, period and vehicle filters and maps unique quote aggregates", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const fakeDatabase = {
    async query(text: string, values: readonly unknown[]) {
      calls.push({ text, values });
      return { rows: [
        { quote_id: "quote-1", requested_at: "2026-01-01T10:00:00.000Z", request_description: "Troca de óleo", brand: "Honda", model: "Civic", year: 2019, event_type: CommercialEventType.QUOTE_RESPONDED },
        { quote_id: "quote-1", requested_at: "2026-01-01T10:00:00.000Z", request_description: "Troca de óleo", brand: "Honda", model: "Civic", year: 2019, event_type: CommercialEventType.QUOTE_PUBLISHED },
      ] };
    },
  } as unknown as PostgresDatabase;

  const demand = await new PostgresAmpliviewAdminReadModel(fakeDatabase).getDemand({
    businessId: "business-a", period: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-03T00:00:00.000Z" }, channel: Channel.WHATSAPP, brand: "Honda", model: "Civic", year: 2019,
  });
  assert.deepEqual(demand.quotes, { requested: 1, responded: 1, published: 1 });
  assert.deepEqual(demand.services, [{ name: "Troca de óleo", quantity: 1, requested: 1, responded: 1, published: 1, delivered: 0 }]);
  assert.deepEqual(demand.models, [{ brand: "Honda", model: "Civic", quantity: 1 }]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.text.includes("quote_requests q"));
  assert.ok(calls[0]?.text.includes("business_id = \$"));
  assert.ok(calls[0]?.values.includes("business-a"));
  assert.ok(calls[0]?.values.includes("WHATSAPP"));
});
