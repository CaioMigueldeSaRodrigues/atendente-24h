import assert from "node:assert/strict";
import test from "node:test";
import type { AutomotiveBusiness, Customer } from "../../src/core/domain/entities.js";
import { BusinessType, Channel } from "../../src/core/domain/enums.js";
import type { CustomerRepository } from "../../src/core/repositories.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteCustomerRepository } from "../../src/infrastructure/sqlite/sqlite-customer-repository.js";
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

const customer = (id: string, businessId: string): Customer => ({
  id,
  businessId,
  name: "Ana Silva",
  primaryPhone: "+5511999999999",
  email: "ana@example.test",
  preferredContactChannel: Channel.WHATSAPP,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-02-03T04:05:06.000Z",
});

const withRepositories = async (
  run: (repository: SqliteCustomerRepository, businessRepository: SqliteAutomotiveBusinessRepository, database: ReturnType<typeof createSqliteDatabase>) => Promise<void>,
) => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  const repository = new SqliteCustomerRepository(database);
  const businessRepository = new SqliteAutomotiveBusinessRepository(database);
  try {
    await run(repository, businessRepository, database);
  } finally {
    database.close();
  }
};

test("satisfies CustomerRepository and round-trips a customer", async () => {
  await withRepositories(async (repository, businesses) => {
    const contract: CustomerRepository = repository;
    await businesses.save(business("business-a"));
    const entity = customer("customer-1", "business-a");
    await contract.save(entity);
    assert.deepEqual(await contract.findById(entity.businessId, entity.id), entity);
  });
});

test("customer identity includes businessId and permits the same id in two businesses", async () => {
  await withRepositories(async (repository, businesses) => {
    await businesses.save(business("business-a"));
    await businesses.save(business("business-b"));
    const first = customer("customer-shared", "business-a");
    const second = { ...customer("customer-shared", "business-b"), name: "Outra pessoa" };
    await repository.save(first);
    await repository.save(second);

    assert.deepEqual(await repository.findById("business-a", first.id), first);
    assert.deepEqual(await repository.findById("business-b", second.id), second);
    assert.equal(await repository.findById("business-c", first.id), null);
  });
});

test("optional fields persist as NULL and return omitted", async () => {
  await withRepositories(async (repository, businesses, database) => {
    await businesses.save(business("business-a"));
    const entity: Customer = {
      id: "customer-minimal",
      businessId: "business-a",
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-02-03T04:05:06.000Z",
    };
    await repository.save(entity);

    const stored = database.prepare(`
      SELECT name, primary_phone, email, preferred_contact_channel
      FROM customers WHERE business_id = ? AND id = ?
    `).get(entity.businessId, entity.id);
    assert.deepEqual(stored && { ...stored }, {
      name: null,
      primary_phone: null,
      email: null,
      preferred_contact_channel: null,
    });
    assert.deepEqual(await repository.findById(entity.businessId, entity.id), entity);
  });
});

test("rejects an invalid stored Channel with a stable error", async () => {
  await withRepositories(async (repository, businesses, database) => {
    await businesses.save(business("business-a"));
    const entity = customer("customer-1", "business-a");
    await repository.save(entity);
    database.prepare("UPDATE customers SET preferred_contact_channel = ? WHERE business_id = ? AND id = ?")
      .run("INVALID", entity.businessId, entity.id);

    await assert.rejects(repository.findById(entity.businessId, entity.id), {
      message: "Failed to load Customer",
    });
  });
});

test("foreign key rejects a Customer for a missing business", async () => {
  await withRepositories(async (repository) => {
    await assert.rejects(repository.save(customer("customer-1", "missing-business")), {
      message: "Failed to save Customer",
    });
  });
});
