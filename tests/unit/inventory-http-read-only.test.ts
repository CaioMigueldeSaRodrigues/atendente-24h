import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { BusinessType, Channel, ConversationStatus, OpportunityStatus, QuoteRequestStatus } from "../../src/core/domain/enums.js";
import { createBasicPlanRuntime } from "../../src/app/basic-plan-runtime.js";

test("POST inventory consults the read port, persists only StockCheck, and never changes the QuoteRequest", async () => {
  const runtime = await createBasicPlanRuntime({
    databasePath: ":memory:",
    business: { businessId: "business-a", businessName: "Oficina A", businessType: BusinessType.WORKSHOP, timezone: "UTC" },
    interpreter: { interpret: async () => { throw new Error("Interpreter should not be called"); } },
    now: () => "2026-09-29T10:30:00.000Z",
  });
  const database = runtime.database;
  database.prepare("INSERT INTO conversations(id,business_id,channel,status,started_at,last_message_at) VALUES(?,?,?,?,?,?)").run("conversation-a", "business-a", Channel.WEB, ConversationStatus.ACTIVE, "2026-09-29T10:00:00.000Z", "2026-09-29T10:00:00.000Z");
  database.prepare("INSERT INTO opportunities(id,business_id,conversation_id,request_description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("opportunity-a", "business-a", "conversation-a", "Freios", OpportunityStatus.WAITING_BUSINESS, "2026-09-29T10:00:00.000Z", "2026-09-29T10:00:00.000Z");
  database.prepare("INSERT INTO quote_requests(id,business_id,opportunity_id,conversation_id,request_description,status,requested_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("quote-a", "business-a", "opportunity-a", "conversation-a", "Freios", QuoteRequestStatus.WAITING_BUSINESS, "2026-09-29T10:00:00.000Z", "2026-09-29T10:00:00.000Z", "2026-09-29T10:00:00.000Z");
  await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${base}/v1/businesses/business-a/quotes/quote-a/inventory`, { method: "POST" });
    assert.equal(response.status, 200);
    const snapshot = await response.json() as Record<string, unknown>;
    assert.equal(typeof snapshot.id, "string");
    assert.deepEqual({
      businessId: snapshot.businessId, conversationId: snapshot.conversationId, quoteRequestId: snapshot.quoteRequestId,
      requestedItem: snapshot.requestedItem, inventoryReference: snapshot.inventoryReference, availability: snapshot.availability,
      source: snapshot.source, checkedAt: snapshot.checkedAt,
    }, {
      businessId: "business-a", conversationId: "conversation-a", quoteRequestId: "quote-a", requestedItem: "Freios",
      inventoryReference: "Freios", availability: "UNKNOWN", source: "provider-unavailable", checkedAt: "2026-09-29T10:30:00.000Z",
    });
    const quote = database.prepare("SELECT status, request_description FROM quote_requests WHERE business_id = ? AND id = ?").get("business-a", "quote-a") as { status: string; request_description: string };
    assert.equal(quote.status, QuoteRequestStatus.WAITING_BUSINESS);
    assert.equal(quote.request_description, "Freios");
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM stock_checks WHERE business_id = ?").get("business-a") as { count: number }).count, 1);
    assert.equal((await fetch(`${base}/v1/businesses/business-a/quotes/quote-a/inventory`)).status, 200);
  } finally {
    await runtime.close();
  }
});
