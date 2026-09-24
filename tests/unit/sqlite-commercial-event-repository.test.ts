import assert from "node:assert/strict";
import test from "node:test";
import type { AutomotiveBusiness, CommercialEvent } from "../../src/core/domain/entities.js";
import { BusinessType, Channel, CommercialEventType, CommercialOutcome, Intent } from "../../src/core/domain/enums.js";
import type { CommercialEventRepository } from "../../src/core/repositories.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteCommercialEventRepository } from "../../src/infrastructure/sqlite/sqlite-commercial-event-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";

const business = (id: string): AutomotiveBusiness => ({
  id, name: id, businessType: BusinessType.WORKSHOP, timezone: "UTC", active: true,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const event = (id: string, businessId: string, overrides: Partial<CommercialEvent> = {}): CommercialEvent => ({
  id, businessId, eventType: CommercialEventType.QUOTE_REQUESTED,
  occurredAt: "2026-01-02T00:00:00.000Z", ...overrides,
});

async function withRepositories(run: (repository: SqliteCommercialEventRepository, database: ReturnType<typeof createSqliteDatabase>) => Promise<void>): Promise<void> {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    const businesses = new SqliteAutomotiveBusinessRepository(database);
    await businesses.save(business("business-a"));
    await businesses.save(business("business-b"));
    await run(new SqliteCommercialEventRepository(database), database);
  } finally { database.close(); }
}

test("SqliteCommercialEventRepository satisfies its contract and round-trips every commercial dimension", async () => {
  await withRepositories(async (repository) => {
    const contract: CommercialEventRepository = repository;
    const complete = event("event-1", "business-a", {
      eventType: CommercialEventType.SYMPTOM_REPORTED,
      conversationId: "conversation-reference", customerId: "customer-reference",
      vehicleId: "vehicle-reference", opportunityId: "opportunity-reference", quoteRequestId: "quote-reference",
      channel: Channel.WEB, intent: Intent.SYMPTOM_REPORT, commercialOutcome: CommercialOutcome.OPPORTUNITY,
      businessType: BusinessType.AUTO_CENTER, country: "BR", state: "SP", city: "Campinas", region: "Sudeste",
      category: "Freios", requestedItem: "Pastilhas", symptom: "Ruído ao frear",
      vehicleBrand: "Toyota", vehicleModel: "Corolla", vehicleYear: 2020,
      amount: { amountCents: 125050, currency: "BRL" },
    });
    await contract.append(complete);
    assert.deepEqual(await contract.listByBusiness("business-a"), [complete]);
    assert.deepEqual(await contract.listByConversation("business-a", "conversation-reference"), [complete]);
    assert.deepEqual(await contract.listByBusiness("business-b"), []);
    assert.deepEqual(await contract.listByConversation("business-b", "conversation-reference"), []);
  });
});

test("commercial events preserve same ids across tenants, but reject duplicate ids in one tenant", async () => {
  await withRepositories(async (repository) => {
    await repository.append(event("shared", "business-a"));
    await repository.append(event("shared", "business-b"));
    assert.equal((await repository.listByBusiness("business-a")).length, 1);
    assert.equal((await repository.listByBusiness("business-b")).length, 1);
    await assert.rejects(repository.append(event("shared", "business-a")), { message: "Failed to append CommercialEvent" });
    assert.equal((await repository.listByBusiness("business-a")).length, 1);
  });
});

test("commercial lists are tenant-filtered and deterministically ordered by occurredAt then id", async () => {
  await withRepositories(async (repository) => {
    await repository.append(event("z", "business-a", { conversationId: "c1" }));
    await repository.append(event("a", "business-a", { conversationId: "c1" }));
    await repository.append(event("later", "business-a", { conversationId: "c1", occurredAt: "2026-01-03T00:00:00.000Z" }));
    await repository.append(event("other-conversation", "business-a", { conversationId: "c2" }));
    await repository.append(event("other-tenant", "business-b", { conversationId: "c1" }));
    assert.deepEqual((await repository.listByBusiness("business-a")).map((item) => item.id), ["a", "other-conversation", "z", "later"]);
    assert.deepEqual((await repository.listByConversation("business-a", "c1")).map((item) => item.id), ["a", "z", "later"]);
    assert.deepEqual((await repository.listByConversation("business-b", "c1")).map((item) => item.id), ["other-tenant"]);
  });
});

test("commercial event optional fields persist as NULL and return omitted", async () => {
  await withRepositories(async (repository, database) => {
    const minimal = event("minimal", "business-a");
    await repository.append(minimal);
    assert.deepEqual(await repository.listByBusiness("business-a"), [minimal]);
    const row = database.prepare(`SELECT conversation_id, customer_id, vehicle_id, opportunity_id,
      quote_request_id, channel, intent, commercial_outcome, business_type, country, state,
      city, region, category, requested_item, symptom, vehicle_brand, vehicle_model,
      vehicle_year, amount_cents, currency FROM commercial_events WHERE business_id = ? AND id = ?`)
      .get("business-a", "minimal");
    assert.ok(row);
    assert.ok(Object.values(row).every((value) => value === null));
  });
});

test("commercial Money preserves exact cent amounts and zero", async () => {
  await withRepositories(async (repository, database) => {
    const exact = event("exact", "business-a", { amount: { amountCents: 125050, currency: "BRL" } });
    const zero = event("zero", "business-a", { amount: { amountCents: 0, currency: "BRL" } });
    await repository.append(exact);
    await repository.append(zero);
    assert.deepEqual((await repository.listByBusiness("business-a")).map((item) => item.amount), [exact.amount, zero.amount]);
    const amount = database.prepare("SELECT amount_cents FROM commercial_events WHERE business_id = ? AND id = ?").get("business-a", "exact");
    assert.deepEqual(amount && { ...amount }, { amount_cents: 125050 });
  });
});

test("SQLite rejects partial Money and currencies other than BRL directly", async (t) => {
  const invalidValues = [
    { id: "amount-without-currency", amount: 100, currency: null },
    { id: "currency-without-amount", amount: null, currency: "BRL" },
    { id: "unsupported-currency", amount: 100, currency: "USD" },
  ] as const;
  for (const invalid of invalidValues) await t.test(invalid.id, async () => withRepositories(async (_repository, database) => {
    const insert = database.prepare(`INSERT INTO commercial_events (
      id, business_id, event_type, amount_cents, currency, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?)`);
    assert.throws(() => insert.run(
      invalid.id, "business-a", CommercialEventType.QUOTE_REQUESTED,
      invalid.amount, invalid.currency, "2026-01-02T00:00:00.000Z",
    ));
  }));
});

test("commercial Money rejects invalid append values and malformed persisted states", async (t) => {
  await t.test("invalid append Money", async () => withRepositories(async (repository) => {
    const invalid = event("invalid", "business-a", { amount: { amountCents: -1, currency: "BRL" } });
    await assert.rejects(repository.append(invalid), { message: "Failed to append CommercialEvent" });
  }));
  for (const [id, amount, currency] of [["partial-amount", 100, null], ["partial-currency", null, "BRL"]] as const) {
    await t.test(id, async () => withRepositories(async (repository, database) => {
      await repository.append(event(id, "business-a"));
      database.exec("PRAGMA ignore_check_constraints = ON");
      database.prepare("UPDATE commercial_events SET amount_cents = ?, currency = ? WHERE business_id = ? AND id = ?")
        .run(amount, currency, "business-a", id);
      await assert.rejects(repository.listByBusiness("business-a"), { message: "Failed to load CommercialEvents" });
    }));
  }
});

test("invalid commercial enum values fail with a stable load error", async (t) => {
  for (const [column, value] of [["event_type", "INVALID"], ["channel", "INVALID"], ["intent", "INVALID"], ["commercial_outcome", "INVALID"], ["business_type", "INVALID"]] as const) {
    await t.test(column, async () => withRepositories(async (repository, database) => {
      await repository.append(event("invalid", "business-a"));
      database.prepare(`UPDATE commercial_events SET ${column} = ? WHERE business_id = ? AND id = ?`).run(value, "business-a", "invalid");
      await assert.rejects(repository.listByBusiness("business-a"), { message: "Failed to load CommercialEvents" });
    }));
  }
});

test("analytical reference ids do not require operational foreign key rows", async () => {
  await withRepositories(async (repository) => {
    const analyticalOnly = event("references", "business-a", {
      conversationId: "deleted-conversation", customerId: "deleted-customer", vehicleId: "deleted-vehicle",
      opportunityId: "deleted-opportunity", quoteRequestId: "deleted-quote",
    });
    await repository.append(analyticalOnly);
    assert.deepEqual(await repository.listByBusiness("business-a"), [analyticalOnly]);
  });
});
