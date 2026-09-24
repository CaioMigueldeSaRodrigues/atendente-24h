import assert from "node:assert/strict";
import test from "node:test";
import type { AutomotiveBusiness, Customer, Vehicle } from "../../src/core/domain/entities.js";
import { BusinessType } from "../../src/core/domain/enums.js";
import type { VehicleRepository } from "../../src/core/repositories.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
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

const customer = (id: string, businessId: string): Customer => ({
  id,
  businessId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const vehicle = (id: string, businessId: string, customerId?: string): Vehicle => ({
  id,
  businessId,
  ...(customerId !== undefined ? { customerId } : {}),
  brand: "Toyota",
  model: "Corolla",
  year: 2020,
  version: "XEi",
  licensePlate: "abc-1234 / exact",
  mileage: 45890,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-02-03T04:05:06.000Z",
});

const withRepositories = async (
  run: (repository: SqliteVehicleRepository, businesses: SqliteAutomotiveBusinessRepository, customers: SqliteCustomerRepository, database: ReturnType<typeof createSqliteDatabase>) => Promise<void>,
) => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await run(
      new SqliteVehicleRepository(database),
      new SqliteAutomotiveBusinessRepository(database),
      new SqliteCustomerRepository(database),
      database,
    );
  } finally {
    database.close();
  }
};

test("satisfies VehicleRepository and round-trips vehicle fields unchanged", async () => {
  await withRepositories(async (repository, businesses, customers) => {
    const contract: VehicleRepository = repository;
    await businesses.save(business("business-a"));
    await customers.save(customer("customer-1", "business-a"));
    const entity = vehicle("vehicle-1", "business-a", "customer-1");
    await contract.save(entity);

    assert.deepEqual(await contract.findById(entity.businessId, entity.id), entity);
  });
});

test("supports an absent customerId and returns it omitted", async () => {
  await withRepositories(async (repository, businesses, _customers, database) => {
    await businesses.save(business("business-a"));
    const entity = vehicle("vehicle-1", "business-a");
    await repository.save(entity);

    const stored = database.prepare(
      "SELECT customer_id FROM vehicles WHERE business_id = ? AND id = ?",
    ).get(entity.businessId, entity.id);
    assert.deepEqual(stored && { ...stored }, { customer_id: null });
    assert.deepEqual(await repository.findById(entity.businessId, entity.id), entity);
  });
});

test("vehicle identity includes businessId and permits the same id in two businesses", async () => {
  await withRepositories(async (repository, businesses) => {
    await businesses.save(business("business-a"));
    await businesses.save(business("business-b"));
    const first = vehicle("vehicle-shared", "business-a");
    const second = { ...vehicle("vehicle-shared", "business-b"), model: "Yaris" };
    await repository.save(first);
    await repository.save(second);

    assert.deepEqual(await repository.findById("business-a", first.id), first);
    assert.deepEqual(await repository.findById("business-b", second.id), second);
    assert.equal(await repository.findById("business-c", first.id), null);
  });
});

test("foreign key rejects a Vehicle linked to a Customer in another business", async () => {
  await withRepositories(async (repository, businesses, customers) => {
    await businesses.save(business("business-a"));
    await businesses.save(business("business-b"));
    await customers.save(customer("customer-1", "business-b"));

    await assert.rejects(
      repository.save(vehicle("vehicle-1", "business-a", "customer-1")),
      { message: "Failed to save Vehicle" },
    );
  });
});
