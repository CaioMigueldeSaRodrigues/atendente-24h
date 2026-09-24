import assert from "node:assert/strict";
import test from "node:test";
import type {
  AutomotiveBusiness,
  Conversation,
  Customer,
  Vehicle,
} from "../../src/core/domain/entities.js";
import {
  BusinessType,
  Channel,
  CommercialOutcome,
  ConversationStatus,
  Intent,
} from "../../src/core/domain/enums.js";
import type { ConversationRepository } from "../../src/core/repositories.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteCustomerRepository } from "../../src/infrastructure/sqlite/sqlite-customer-repository.js";
import { SqliteVehicleRepository } from "../../src/infrastructure/sqlite/sqlite-vehicle-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";

const business = (id: string): AutomotiveBusiness => ({
  id,
  name: `Business ${id}`,
  businessType: BusinessType.OTHER,
  timezone: "UTC",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const conversation = (
  id: string,
  businessId: string,
  related: { customerId?: string; vehicleId?: string } = {},
): Conversation => ({
  id,
  businessId,
  ...related,
  channel: Channel.WHATSAPP,
  status: ConversationStatus.ACTIVE,
  commercialOutcome: CommercialOutcome.LEAD,
  currentIntent: Intent.SERVICE_INQUIRY,
  startedAt: "2026-01-02T03:04:05.000Z",
  lastMessageAt: "2026-01-03T04:05:06.000Z",
  closedAt: "2026-01-04T05:06:07.000Z",
});

const withRepositories = async (
  run: (
    repository: SqliteConversationRepository,
    businesses: SqliteAutomotiveBusinessRepository,
    customers: SqliteCustomerRepository,
    vehicles: SqliteVehicleRepository,
    database: ReturnType<typeof createSqliteDatabase>,
  ) => Promise<void>,
) => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await run(
      new SqliteConversationRepository(database),
      new SqliteAutomotiveBusinessRepository(database),
      new SqliteCustomerRepository(database),
      new SqliteVehicleRepository(database),
      database,
    );
  } finally {
    database.close();
  }
};

const seedBusiness = async (
  repository: SqliteAutomotiveBusinessRepository,
  id: string,
) => repository.save(business(id));

test("satisfies ConversationRepository and round-trips all fields", async () => {
  await withRepositories(async (repository, businesses) => {
    const contract: ConversationRepository = repository;
    await seedBusiness(businesses, "business-a");
    const entity = conversation("conversation-1", "business-a");
    await contract.save(entity);
    assert.deepEqual(await contract.findById(entity.businessId, entity.id), entity);
  });
});

test("same conversation id can exist in different businesses", async () => {
  await withRepositories(async (repository, businesses) => {
    await seedBusiness(businesses, "business-a");
    await seedBusiness(businesses, "business-b");
    const first = conversation("shared-id", "business-a");
    const second = { ...conversation("shared-id", "business-b"), status: ConversationStatus.CLOSED };
    await repository.save(first);
    await repository.save(second);

    assert.deepEqual(await repository.findById("business-a", first.id), first);
    assert.deepEqual(await repository.findById("business-b", second.id), second);
    assert.equal(await repository.findById("business-c", first.id), null);
  });
});

test("customerId and vehicleId may be absent and nullable fields return omitted", async () => {
  await withRepositories(async (repository, businesses, _customers, _vehicles, database) => {
    await seedBusiness(businesses, "business-a");
    const entity: Conversation = {
      id: "conversation-minimal",
      businessId: "business-a",
      channel: Channel.WEB,
      status: ConversationStatus.WAITING_CUSTOMER,
      startedAt: "2026-01-02T03:04:05.000Z",
      lastMessageAt: "2026-01-03T04:05:06.000Z",
    };
    await repository.save(entity);
    const stored = database.prepare(`
      SELECT customer_id, vehicle_id, commercial_outcome, current_intent, closed_at
      FROM conversations WHERE business_id = ? AND id = ?
    `).get(entity.businessId, entity.id);
    assert.deepEqual(stored && { ...stored }, {
      customer_id: null,
      vehicle_id: null,
      commercial_outcome: null,
      current_intent: null,
      closed_at: null,
    });
    assert.deepEqual(await repository.findById(entity.businessId, entity.id), entity);
  });
});

test("validates and round-trips Channel, status, outcome, and intent", async () => {
  await withRepositories(async (repository, businesses) => {
    await seedBusiness(businesses, "business-a");
    const entity = conversation("conversation-1", "business-a");
    await repository.save(entity);
    const loaded = await repository.findById(entity.businessId, entity.id);
    assert.equal(loaded?.channel, Channel.WHATSAPP);
    assert.equal(loaded?.status, ConversationStatus.ACTIVE);
    assert.equal(loaded?.commercialOutcome, CommercialOutcome.LEAD);
    assert.equal(loaded?.currentIntent, Intent.SERVICE_INQUIRY);
  });
});

test("rejects invalid stored enum values with a stable error", async (t) => {
  const invalidCases = [
    ["channel", "INVALID_CHANNEL"],
    ["status", "INVALID_STATUS"],
    ["commercial_outcome", "INVALID_OUTCOME"],
    ["current_intent", "INVALID_INTENT"],
  ] as const;

  for (const [column, value] of invalidCases) {
    await t.test(column, async () => {
      await withRepositories(async (repository, businesses, _customers, _vehicles, database) => {
        await seedBusiness(businesses, "business-a");
        const entity = conversation("conversation-1", "business-a");
        await repository.save(entity);
        database.prepare(`UPDATE conversations SET ${column} = ? WHERE business_id = ? AND id = ?`)
          .run(value, entity.businessId, entity.id);
        await assert.rejects(repository.findById(entity.businessId, entity.id), {
          message: "Failed to load Conversation",
        });
      });
    });
  }
});

test("conversation foreign keys reject Customer and Vehicle from another business", async (t) => {
  await t.test("cross-business Customer", async () => {
    await withRepositories(async (repository, businesses, customers) => {
      await seedBusiness(businesses, "business-a");
      await seedBusiness(businesses, "business-b");
      const customer: Customer = {
        id: "customer-1",
        businessId: "business-b",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      await customers.save(customer);
      await assert.rejects(
        repository.save(conversation("conversation-1", "business-a", { customerId: customer.id })),
        { message: "Failed to save Conversation" },
      );
    });
  });

  await t.test("cross-business Vehicle", async () => {
    await withRepositories(async (repository, businesses, _customers, vehicles) => {
      await seedBusiness(businesses, "business-a");
      await seedBusiness(businesses, "business-b");
      const vehicle: Vehicle = {
        id: "vehicle-1",
        businessId: "business-b",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      await vehicles.save(vehicle);
      await assert.rejects(
        repository.save(conversation("conversation-1", "business-a", { vehicleId: vehicle.id })),
        { message: "Failed to save Conversation" },
      );
    });
  });
});

test("updates a conversation by the same business_id and id", async () => {
  await withRepositories(async (repository, businesses) => {
    await seedBusiness(businesses, "business-a");
    const original = conversation("conversation-1", "business-a");
    await repository.save(original);
    const updated = { ...original, status: ConversationStatus.WAITING_HUMAN };
    await repository.save(updated);

    assert.deepEqual(await repository.findById("business-a", original.id), updated);
  });
});
