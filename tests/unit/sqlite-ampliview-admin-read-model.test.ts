import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";
import { SqliteAmpliviewAdminReadModel } from "../../src/infrastructure/sqlite/sqlite-ampliview-admin-read-model.js";
import { createBasicPlanHttpServer, type BasicPlanHttpServerDependencies } from "../../src/infrastructure/http/basic-plan-http-server.js";
import { Channel, CommercialEventType, CommercialOutcome, ConversationStatus, Intent, OpportunityStatus, OutboundDeliveryStatus, QuoteRequestStatus, SenderType } from "../../src/core/domain/enums.js";
import type { AdminBusinessScopeAuthorizer } from "../../src/core/admin-read-model.js";
import { buildAdminDemand } from "../../src/core/admin-demand.js";

const period = { from: "2026-01-01T00:00:00.000Z", to: "2026-01-03T00:00:00.000Z" };

function insert(database: DatabaseSync, sql: string, ...values: any[]): void {
  database.prepare(sql).run(...values);
}

function seed(database: DatabaseSync): void {
  const businesses = ["business-a", "business-b"];
  for (const businessId of businesses) {
    insert(database, "INSERT INTO automotive_businesses(id,name,business_type,timezone,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", businessId, `Oficina ${businessId}`, "WORKSHOP", "America/Sao_Paulo", 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    for (const suffix of ["1", "2"]) {
      const customerId = `${businessId}-customer-${suffix}`;
      const vehicleId = `${businessId}-vehicle-${suffix}`;
      const conversationId = `${businessId}-conversation-${suffix}`;
      const opportunityId = `${businessId}-opportunity-${suffix}`;
      const quoteId = `${businessId}-quote-${suffix}`;
      const base = suffix === "1" ? "2026-01-01T10:00:00.000Z" : "2026-01-02T10:00:00.000Z";
      const last = suffix === "1" ? "2026-01-01T11:35:00.000Z" : "2026-01-02T10:05:00.000Z";
      insert(database, "INSERT INTO customers(id,business_id,name,primary_phone,email,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", customerId, businessId, `Cliente ${businessId}-${suffix}`, `55119999${suffix}`, `cliente-${businessId}-${suffix}@example.test`, base, base);
      insert(database, "INSERT INTO vehicles(id,business_id,customer_id,brand,model,year,version,license_plate,mileage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", vehicleId, businessId, customerId, "Chevrolet", suffix === "1" ? "Onix" : "Tracker", 2020, suffix === "1" ? "LT" : "Premier", null, 50000, base, base);
      insert(database, "INSERT INTO conversations(id,business_id,customer_id,vehicle_id,channel,status,commercial_outcome,current_intent,started_at,last_message_at) VALUES(?,?,?,?,?,?,?,?,?,?)", conversationId, businessId, customerId, vehicleId, Channel.WHATSAPP, ConversationStatus.ACTIVE, CommercialOutcome.QUOTE_REQUESTED, Intent.QUOTE_REQUEST, base, last);
      insert(database, "INSERT INTO opportunities(id,business_id,conversation_id,customer_id,vehicle_id,request_description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", opportunityId, businessId, conversationId, customerId, vehicleId, suffix === "1" ? "Troca de óleo" : "Revisão", suffix === "1" ? OpportunityStatus.WAITING_BUSINESS : OpportunityStatus.WAITING_CUSTOMER, base, last);
      insert(database, "INSERT INTO quote_requests(id,business_id,opportunity_id,conversation_id,customer_id,vehicle_id,request_description,symptom_description,status,requested_at,responded_at,authorized_price_amount_cents,authorized_price_currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", quoteId, businessId, opportunityId, conversationId, customerId, vehicleId, suffix === "1" ? "Troca de óleo" : "Revisão", suffix === "1" ? null : "Luz de manutenção", suffix === "1" ? QuoteRequestStatus.RESPONDED : QuoteRequestStatus.WAITING_INFORMATION, base, suffix === "1" ? "2026-01-01T11:00:00.000Z" : null, suffix === "1" ? 65000 : null, suffix === "1" ? "BRL" : null, base, last);
      insert(database, "INSERT INTO messages(id,business_id,conversation_id,sender_type,channel,content,created_at) VALUES(?,?,?,?,?,?,?)", `${conversationId}-customer-message`, businessId, conversationId, SenderType.CUSTOMER, Channel.WHATSAPP, `Solicitação ${suffix}`, base);
      insert(database, "INSERT INTO messages(id,business_id,conversation_id,sender_type,channel,content,created_at) VALUES(?,?,?,?,?,?,?)", `${conversationId}-assistant-message`, businessId, conversationId, SenderType.ASSISTANT, Channel.WHATSAPP, `Resposta ${suffix}`, last);
      insert(database, "INSERT INTO commercial_events(id,business_id,event_type,conversation_id,customer_id,vehicle_id,opportunity_id,quote_request_id,channel,requested_item,vehicle_brand,vehicle_model,vehicle_year,amount_cents,currency,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", `${quoteId}-requested`, businessId, CommercialEventType.QUOTE_REQUESTED, conversationId, customerId, vehicleId, opportunityId, quoteId, Channel.WHATSAPP, suffix === "1" ? "Troca de óleo" : "Revisão", "Chevrolet", suffix === "1" ? "Onix" : "Tracker", 2020, null, null, base);
      if (suffix === "1") {
        insert(database, "INSERT INTO commercial_events(id,business_id,event_type,conversation_id,customer_id,vehicle_id,opportunity_id,quote_request_id,channel,requested_item,vehicle_brand,vehicle_model,vehicle_year,amount_cents,currency,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", `${quoteId}-responded`, businessId, CommercialEventType.QUOTE_RESPONDED, conversationId, customerId, vehicleId, opportunityId, quoteId, Channel.WHATSAPP, "Troca de óleo", "Chevrolet", "Onix", 2020, 65000, "BRL", "2026-01-01T11:00:00.000Z");
        insert(database, "INSERT INTO commercial_events(id,business_id,event_type,conversation_id,customer_id,vehicle_id,opportunity_id,quote_request_id,channel,requested_item,vehicle_brand,vehicle_model,vehicle_year,amount_cents,currency,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", `${quoteId}-published`, businessId, CommercialEventType.QUOTE_PUBLISHED, conversationId, customerId, vehicleId, opportunityId, quoteId, Channel.WHATSAPP, "Troca de óleo", "Chevrolet", "Onix", 2020, 65000, "BRL", "2026-01-01T11:30:00.000Z");
        insert(database, "INSERT INTO outbound_deliveries(id,business_id,message_id,quote_request_id,conversation_id,channel,recipient_ref,status,attempts,created_at,updated_at,delivered_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", `${quoteId}-delivery`, businessId, `${conversationId}-assistant-message`, quoteId, conversationId, Channel.WHATSAPP, "551199991@s.whatsapp.net", OutboundDeliveryStatus.DELIVERED, 1, "2026-01-01T11:30:00.000Z", "2026-01-01T11:35:00.000Z", "2026-01-01T11:35:00.000Z");
      } else {
        insert(database, "INSERT INTO outbound_deliveries(id,business_id,message_id,quote_request_id,conversation_id,channel,recipient_ref,status,attempts,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", `${quoteId}-delivery`, businessId, null, quoteId, conversationId, Channel.WHATSAPP, "551199992@s.whatsapp.net", OutboundDeliveryStatus.FAILED_RETRYABLE, 1, "temporarily unavailable", base, last);
      }
    }
  }
}

function adminDependencies(readModel: SqliteAmpliviewAdminReadModel, authorizer: AdminBusinessScopeAuthorizer): BasicPlanHttpServerDependencies {
  return { adminQueryService: readModel, adminBusinessScopeAuthorizer: authorizer } as unknown as BasicPlanHttpServerDependencies;
}

test("SQLite administrative read model calculates real overview and enforces tenant filters", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    seed(database);
    const readModel = new SqliteAmpliviewAdminReadModel(database);
    const overview = await readModel.getOverview({ businessId: "business-a", period });
    assert.equal(overview.conversations, 2);
    assert.equal(overview.customers, 2);
    assert.equal(overview.vehicles, 2);
    assert.equal(overview.quoteRequests, 2);
    assert.equal(overview.quoteResponded, 1);
    assert.equal(overview.quotePublished, 1);
    assert.equal(overview.deliveriesDelivered, 1);
    assert.equal(overview.deliveriesPending, 0);
    assert.equal(overview.deliveriesFailed, 1);
    assert.equal(overview.authorizedValueTotal.amountCents, 65000);
    assert.equal(overview.authorizedTicketAverage?.amountCents, 65000);
    assert.equal(overview.averageRequestToResponseMs, 3_600_000);
    assert.equal(overview.averageResponseToPublishMs, 1_800_000);
    assert.equal(overview.averagePublishToDeliveryMs, 300_000);

    const firstPage = await readModel.listConversations({ businessId: "business-a", period, page: 1, pageSize: 1 });
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.items[0]?.vehicle?.model, "Tracker");
    assert.equal(firstPage.items[0]?.quoteRequest?.status, QuoteRequestStatus.WAITING_INFORMATION);
    assert.equal(firstPage.items[0]?.delivery?.status, OutboundDeliveryStatus.FAILED_RETRYABLE);
    const secondPage = await readModel.listConversations({ businessId: "business-a", period, page: 2, pageSize: 1 });
    assert.equal(secondPage.items[0]?.vehicle?.model, "Onix");
    assert.equal(secondPage.items[0]?.lastMessage?.senderType, SenderType.ASSISTANT);

    const detail = await readModel.getConversation({ businessId: "business-a", conversationId: "business-a-conversation-1" });
    assert.ok(detail);
    assert.equal(detail.customer?.name, "Cliente business-a-1");
    assert.deepEqual(detail.messages.map((message) => message.senderType), [SenderType.CUSTOMER, SenderType.ASSISTANT]);
    assert.deepEqual(detail.commercialEvents.map((event) => event.eventType), [CommercialEventType.QUOTE_REQUESTED, CommercialEventType.QUOTE_RESPONDED, CommercialEventType.QUOTE_PUBLISHED]);
    assert.equal(detail.outboundDeliveries[0]?.status, OutboundDeliveryStatus.DELIVERED);
    assert.equal(await readModel.getConversation({ businessId: "business-a", conversationId: "business-b-conversation-1" }), null);
    assert.equal((await readModel.getOverview({ businessId: "business-b", period })).quotePublished, 1);

    const demand = await readModel.getDemand({ businessId: "business-a", period });
    assert.deepEqual(demand.quotes, { requested: 2, responded: 1, published: 1 });
    assert.deepEqual(demand.services, [
      { name: "Revis\u00e3o", quantity: 1, requested: 1, responded: 0, published: 0, delivered: 0 },
      { name: "Troca de \u00f3leo", quantity: 1, requested: 1, responded: 1, published: 1, delivered: 1 },
    ]);
    assert.deepEqual(demand.brands, [{ name: "Chevrolet", quantity: 2 }]);
    assert.deepEqual(demand.models, [{ brand: "Chevrolet", model: "Onix", quantity: 1 }, { brand: "Chevrolet", model: "Tracker", quantity: 1 }]);
    assert.deepEqual(demand.years, [{ year: 2020, quantity: 2 }]);
    assert.deepEqual(demand.timeline, [{ period: "2026-01-01", quantity: 1 }, { period: "2026-01-02", quantity: 1 }]);
    assert.equal((await readModel.getDemand({ businessId: "business-b", period })).quotes.requested, 2);
  } finally {
    database.close();
  }
});

test("demand normalization groups casing and whitespace without double counting quote events", () => {
  const demand = buildAdminDemand({ businessId: "business-a" }, [
    { quoteId: "quote-1", requestedAt: "2026-01-01T10:00:00.000Z", requestDescription: "Troca de óleo", brand: "Honda", model: "Civic", year: 2019, eventType: CommercialEventType.QUOTE_RESPONDED },
    { quoteId: "quote-1", requestedAt: "2026-01-01T10:00:00.000Z", requestDescription: "Troca de óleo", brand: "Honda", model: "Civic", year: 2019, eventType: CommercialEventType.QUOTE_PUBLISHED },
    { quoteId: "quote-2", requestedAt: "2026-01-02T10:00:00.000Z", requestDescription: "  troca   de óleo ", brand: "honda", model: " civic ", year: 2019 },
  ]);
  assert.deepEqual(demand.services, [{ name: "Troca de óleo", quantity: 2, requested: 2, responded: 1, published: 1, delivered: 0 }]);
  assert.deepEqual(demand.brands, [{ name: "Honda", quantity: 2 }]);
  assert.deepEqual(demand.models, [{ brand: "Honda", model: "Civic", quantity: 2 }]);
  assert.deepEqual(demand.years, [{ year: 2019, quantity: 2 }]);
  assert.deepEqual(demand.quotes, { requested: 2, responded: 1, published: 1 });
});

test("administrative API validates scope, period and exposes overview/list/detail DTOs", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  const server = createBasicPlanHttpServer(adminDependencies(new SqliteAmpliviewAdminReadModel(database), { isAuthorized: async ({ businessId }) => businessId === "business-a" }));
  seed(database);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const overviewResponse = await fetch(`${baseUrl}/v1/admin/overview?businessId=business-a&from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`);
    const overviewBody = await overviewResponse.text();
    assert.equal(overviewResponse.status, 200, overviewBody);
    const overview = JSON.parse(overviewBody) as { quotePublished: number };
    assert.equal(overview.quotePublished, 1);
    const demandResponse = await fetch(`${baseUrl}/v1/admin/demand?businessId=business-a&from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}&channel=WHATSAPP&brand=chevrolet`);
    assert.equal(demandResponse.status, 200);
    const demand = await demandResponse.json() as { quotes: { requested: number; responded: number; published: number }; brands: Array<{ name: string; quantity: number }> };
    assert.deepEqual(demand.quotes, { requested: 2, responded: 1, published: 1 });
    assert.deepEqual(demand.brands, [{ name: "Chevrolet", quantity: 2 }]);
    const filteredDemandResponse = await fetch(`${baseUrl}/v1/admin/demand?businessId=business-a&service=troca&brand=chevrolet&model=onix&year=2020&from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`);
    const filteredDemand = await filteredDemandResponse.json() as { quotes: { requested: number; responded: number; published: number } };
    assert.equal(filteredDemandResponse.status, 200);
    assert.deepEqual(filteredDemand.quotes, { requested: 1, responded: 1, published: 1 });
    const listResponse = await fetch(`${baseUrl}/v1/admin/conversations?businessId=business-a&page=1&pageSize=1&brand=Chevrolet`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json() as { total: number; items: Array<{ vehicle?: { brand?: string } }> };
    assert.equal(list.total, 2);
    assert.equal(list.items[0]?.vehicle?.brand, "Chevrolet");
    const detailResponse = await fetch(`${baseUrl}/v1/admin/conversations/business-a-conversation-1?businessId=business-a`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as { messages: unknown[]; commercialEvents: unknown[] };
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.commercialEvents.length, 3);
    assert.equal((await fetch(`${baseUrl}/v1/admin/overview?businessId=business-b`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/v1/admin/demand?businessId=business-b`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/v1/admin/overview?businessId=business-a&from=invalid`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/v1/admin/demand?businessId=business-a&year=invalid`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/v1/admin/overview`)).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});
