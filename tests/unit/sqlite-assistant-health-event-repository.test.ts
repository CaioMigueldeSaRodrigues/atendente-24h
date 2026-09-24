import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantHealthEvent, AutomotiveBusiness } from "../../src/core/domain/entities.js";
import { AssistantHealthEventType, BusinessType, Channel } from "../../src/core/domain/enums.js";
import type { AssistantHealthEventRepository } from "../../src/core/repositories.js";
import { SqliteAssistantHealthEventRepository } from "../../src/infrastructure/sqlite/sqlite-assistant-health-event-repository.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";

const business = (id: string): AutomotiveBusiness => ({
  id, name: id, businessType: BusinessType.WORKSHOP, timezone: "UTC", active: true,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const event = (id: string, businessId: string, overrides: Partial<AssistantHealthEvent> = {}): AssistantHealthEvent => ({
  id, businessId, eventType: AssistantHealthEventType.LOW_CONFIDENCE,
  occurredAt: "2026-01-02T00:00:00.000Z", ...overrides,
});

async function withRepositories(run: (repository: SqliteAssistantHealthEventRepository, database: ReturnType<typeof createSqliteDatabase>) => Promise<void>): Promise<void> {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    const businesses = new SqliteAutomotiveBusinessRepository(database);
    await businesses.save(business("business-a"));
    await businesses.save(business("business-b"));
    await run(new SqliteAssistantHealthEventRepository(database), database);
  } finally { database.close(); }
}

test("SqliteAssistantHealthEventRepository satisfies its contract and round-trips health data without direct PII fields", async () => {
  await withRepositories(async (repository) => {
    const contract: AssistantHealthEventRepository = repository;
    const complete = event("health-1", "business-a", {
      eventType: AssistantHealthEventType.INTEGRATION_FAILURE,
      conversationId: "conversation-reference", opportunityId: "opportunity-reference", quoteRequestId: "quote-reference",
      channel: Channel.WHATSAPP, businessType: BusinessType.AUTO_CENTER,
      country: "BR", state: "SP", city: "Campinas", region: "Sudeste",
      provider: "provider-x", model: "model-y", reason: "PROVIDER_UNAVAILABLE",
    });
    await contract.append(complete);
    assert.deepEqual(await contract.listByBusiness("business-a"), [complete]);
    assert.deepEqual(await contract.listByConversation("business-a", "conversation-reference"), [complete]);
    assert.deepEqual(await contract.listByBusiness("business-b"), []);
    assert.deepEqual(await contract.listByConversation("business-b", "conversation-reference"), []);
  });
});

test("health events permit same id across businesses and reject a duplicate within one business", async () => {
  await withRepositories(async (repository) => {
    await repository.append(event("shared", "business-a"));
    await repository.append(event("shared", "business-b"));
    assert.equal((await repository.listByBusiness("business-a")).length, 1);
    assert.equal((await repository.listByBusiness("business-b")).length, 1);
    await assert.rejects(repository.append(event("shared", "business-a")), { message: "Failed to append AssistantHealthEvent" });
  });
});

test("health event listings are tenant-filtered and ordered by timestamp then id", async () => {
  await withRepositories(async (repository) => {
    await repository.append(event("z", "business-a", { conversationId: "c1" }));
    await repository.append(event("a", "business-a", { conversationId: "c1" }));
    await repository.append(event("later", "business-a", { conversationId: "c1", occurredAt: "2026-01-03T00:00:00.000Z" }));
    await repository.append(event("other-conversation", "business-a", { conversationId: "c2" }));
    await repository.append(event("other-business", "business-b", { conversationId: "c1" }));
    assert.deepEqual((await repository.listByBusiness("business-a")).map((item) => item.id), ["a", "other-conversation", "z", "later"]);
    assert.deepEqual((await repository.listByConversation("business-a", "c1")).map((item) => item.id), ["a", "z", "later"]);
    assert.deepEqual((await repository.listByConversation("business-b", "c1")).map((item) => item.id), ["other-business"]);
  });
});

test("health event optionals persist as NULL and are omitted when loaded", async () => {
  await withRepositories(async (repository, database) => {
    const minimal = event("minimal", "business-a");
    await repository.append(minimal);
    assert.deepEqual(await repository.listByBusiness("business-a"), [minimal]);
    const row = database.prepare(`SELECT conversation_id, opportunity_id, quote_request_id,
      channel, business_type, country, state, city, region, provider, model, reason
      FROM assistant_health_events WHERE business_id = ? AND id = ?`).get("business-a", "minimal");
    assert.ok(row);
    assert.ok(Object.values(row).every((value) => value === null));
  });
});

test("invalid health event type, Channel, and BusinessType fail with a stable load error", async (t) => {
  for (const [column, value] of [["event_type", "INVALID"], ["channel", "INVALID"], ["business_type", "INVALID"]] as const) {
    await t.test(column, async () => withRepositories(async (repository, database) => {
      await repository.append(event("invalid", "business-a"));
      database.prepare(`UPDATE assistant_health_events SET ${column} = ? WHERE business_id = ? AND id = ?`).run(value, "business-a", "invalid");
      await assert.rejects(repository.listByBusiness("business-a"), { message: "Failed to load AssistantHealthEvents" });
    }));
  }
});

test("health event operational references remain optional analytical ids", async () => {
  await withRepositories(async (repository) => {
    const analyticalOnly = event("references", "business-a", {
      conversationId: "deleted-conversation", opportunityId: "deleted-opportunity", quoteRequestId: "deleted-quote",
    });
    await repository.append(analyticalOnly);
    assert.deepEqual(await repository.listByBusiness("business-a"), [analyticalOnly]);
  });
});
