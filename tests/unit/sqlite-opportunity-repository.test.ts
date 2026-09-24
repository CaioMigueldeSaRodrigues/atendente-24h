import assert from "node:assert/strict";
import test from "node:test";
import type { AutomotiveBusiness, Conversation, Customer, Opportunity, Vehicle } from "../../src/core/domain/entities.js";
import { BusinessType, Channel, ConversationStatus, OpportunityStatus } from "../../src/core/domain/enums.js";
import type { OpportunityRepository } from "../../src/core/repositories.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteCustomerRepository } from "../../src/infrastructure/sqlite/sqlite-customer-repository.js";
import { SqliteOpportunityRepository } from "../../src/infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteVehicleRepository } from "../../src/infrastructure/sqlite/sqlite-vehicle-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";

const business = (id: string): AutomotiveBusiness => ({
  id, name: `Business ${id}`, businessType: BusinessType.OTHER, timezone: "UTC",
  active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const conversation = (id: string, businessId: string): Conversation => ({
  id, businessId, channel: Channel.WEB, status: ConversationStatus.ACTIVE,
  startedAt: "2026-01-01T00:00:00.000Z", lastMessageAt: "2026-01-01T00:00:00.000Z",
});
const customer = (id: string, businessId: string): Customer => ({
  id, businessId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const vehicle = (id: string, businessId: string): Vehicle => ({
  id, businessId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const opportunity = (id: string, businessId: string, overrides: Partial<Opportunity> = {}): Opportunity => ({
  id, businessId, conversationId: "conversation-1", status: OpportunityStatus.WAITING_BUSINESS,
  createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", ...overrides,
});

const withRepositories = async (run: (
  opportunities: SqliteOpportunityRepository,
  businesses: SqliteAutomotiveBusinessRepository,
  conversations: SqliteConversationRepository,
  customers: SqliteCustomerRepository,
  vehicles: SqliteVehicleRepository,
  database: ReturnType<typeof createSqliteDatabase>,
) => Promise<void>) => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await run(new SqliteOpportunityRepository(database), new SqliteAutomotiveBusinessRepository(database),
      new SqliteConversationRepository(database), new SqliteCustomerRepository(database),
      new SqliteVehicleRepository(database), database);
  } finally { database.close(); }
};

const seedBase = async (businesses: SqliteAutomotiveBusinessRepository,
  conversations: SqliteConversationRepository, businessId: string) => {
  await businesses.save(business(businessId));
  await conversations.save(conversation("conversation-1", businessId));
};

test("satisfies OpportunityRepository and round-trips an opportunity", async () => {
  await withRepositories(async (repository, businesses, conversations) => {
    const contract: OpportunityRepository = repository;
    await seedBase(businesses, conversations, "business-a");
    const entity = opportunity("opportunity-1", "business-a");
    await contract.save(entity);
    assert.deepEqual(await contract.findById(entity.businessId, entity.id), entity);
  });
});

test("listByConversation filters tenant and conversation and orders created_at then id", async () => {
  await withRepositories(async (repository, businesses, conversations) => {
    await seedBase(businesses, conversations, "business-a");
    await conversations.save(conversation("conversation-2", "business-a"));
    await seedBase(businesses, conversations, "business-b");
    await repository.save(opportunity("b", "business-a", { createdAt: "2026-01-03T00:00:00.000Z" }));
    await repository.save(opportunity("z", "business-a", { createdAt: "2026-01-02T00:00:00.000Z" }));
    await repository.save(opportunity("a", "business-a", { createdAt: "2026-01-02T00:00:00.000Z" }));
    await repository.save(opportunity("other-conversation", "business-a", { conversationId: "conversation-2" }));
    await repository.save(opportunity("other-business", "business-b"));
    assert.deepEqual((await repository.listByConversation("business-a", "conversation-1")).map((item) => item.id), ["a", "z", "b"]);
    assert.deepEqual((await repository.listByConversation("business-b", "conversation-1")).map((item) => item.id), ["other-business"]);
  });
});

test("composite identity allows same id per business and absent optionals round-trip", async () => {
  await withRepositories(async (repository, businesses, conversations, _customers, _vehicles, database) => {
    await seedBase(businesses, conversations, "business-a");
    await seedBase(businesses, conversations, "business-b");
    const first = opportunity("shared", "business-a");
    const second = opportunity("shared", "business-b", { status: OpportunityStatus.OPEN });
    await repository.save(first);
    await repository.save(second);
    assert.deepEqual(await repository.findById("business-a", first.id), first);
    assert.deepEqual(await repository.findById("business-b", second.id), second);
    assert.equal(await repository.findById("business-c", first.id), null);
    const stored = database.prepare(`SELECT customer_id, vehicle_id, request_description, next_action,
      estimated_value_amount_cents, estimated_value_currency, realized_value_amount_cents,
      realized_value_currency, closed_at FROM opportunities WHERE business_id = ? AND id = ?`)
      .get("business-a", first.id);
    assert.deepEqual(stored && { ...stored }, {
      customer_id: null, vehicle_id: null, request_description: null, next_action: null,
      estimated_value_amount_cents: null, estimated_value_currency: null,
      realized_value_amount_cents: null, realized_value_currency: null, closed_at: null,
    });
  });
});

test("round-trips NextAction and exact monetary cents including zero", async () => {
  await withRepositories(async (repository, businesses, conversations, _customers, _vehicles, database) => {
    await seedBase(businesses, conversations, "business-a");
    const entity = opportunity("opportunity-1", "business-a", {
      status: OpportunityStatus.WAITING_CUSTOMER,
      nextAction: { type: "REQUEST_INFORMATION", description: "Aguardar decisão", dueAt: "2026-02-01T00:00:00.000Z", assignedTo: "agent-1" },
      estimatedValue: { amountCents: 125050, currency: "BRL" },
      realizedValue: { amountCents: 0, currency: "BRL" },
      closedAt: "2026-03-01T00:00:00.000Z",
    });
    await repository.save(entity);
    assert.deepEqual(await repository.findById(entity.businessId, entity.id), entity);
    const stored = database.prepare(`SELECT estimated_value_amount_cents, realized_value_amount_cents
      FROM opportunities WHERE business_id = ? AND id = ?`).get(entity.businessId, entity.id);
    assert.deepEqual(stored && { ...stored }, { estimated_value_amount_cents: 125050, realized_value_amount_cents: 0 });
  });
});

test("invalid status and malformed NextAction values fail predictably", async (t) => {
  const cases = [["status", "INVALID"], ["next_action", "not-json"],
    ["next_action", JSON.stringify({ type: "UNKNOWN", description: "bad" })],
    ["next_action", JSON.stringify({ type: "NONE", description: 42 })]] as const;
  for (const [column, value] of cases) await t.test(`${column} ${value}`, async () => {
    await withRepositories(async (repository, businesses, conversations, _customers, _vehicles, database) => {
      await seedBase(businesses, conversations, "business-a");
      const entity = opportunity("opportunity-1", "business-a");
      await repository.save(entity);
      database.prepare(`UPDATE opportunities SET ${column} = ? WHERE business_id = ? AND id = ?`)
        .run(value, entity.businessId, entity.id);
      await assert.rejects(repository.findById(entity.businessId, entity.id), { message: "Failed to load Opportunity" });
    });
  });
});

test("partially persisted Money values fail to load", async (t) => {
  const values = [
    ["estimated_value_amount_cents", 100], ["estimated_value_currency", "BRL"],
    ["realized_value_amount_cents", 100], ["realized_value_currency", "BRL"],
  ] as const;
  for (const [column, value] of values) await t.test(column, async () => {
    await withRepositories(async (repository, businesses, conversations, _customers, _vehicles, database) => {
      await seedBase(businesses, conversations, "business-a");
      const entity = opportunity("opportunity-1", "business-a");
      await repository.save(entity);
      database.prepare(`UPDATE opportunities SET ${column} = ? WHERE business_id = ? AND id = ?`)
        .run(value, entity.businessId, entity.id);
      await assert.rejects(repository.findById(entity.businessId, entity.id), { message: "Failed to load Opportunity" });
    });
  });
});

test("foreign keys reject cross-business Conversation, Customer, and Vehicle", async (t) => {
  for (const relation of ["conversation", "customer", "vehicle"] as const) await t.test(relation, async () => {
    await withRepositories(async (repository, businesses, conversations, customers, vehicles) => {
      await seedBase(businesses, conversations, "business-a");
      await seedBase(businesses, conversations, "business-b");
      let related: Partial<Opportunity>;
      if (relation === "conversation") {
        await conversations.save(conversation("conversation-b", "business-b"));
        related = { conversationId: "conversation-b" };
      } else if (relation === "customer") {
        await customers.save(customer("customer-b", "business-b"));
        related = { customerId: "customer-b" };
      } else {
        await vehicles.save(vehicle("vehicle-b", "business-b"));
        related = { vehicleId: "vehicle-b" };
      }
      await assert.rejects(repository.save(opportunity("opportunity-1", "business-a", related)), { message: "Failed to save Opportunity" });
    });
  });
});
