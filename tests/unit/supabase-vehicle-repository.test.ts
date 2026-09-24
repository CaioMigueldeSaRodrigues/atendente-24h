import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Vehicle } from "../../src/core/domain/entities.js";
import type { VehicleRepository } from "../../src/core/repositories.js";
import type { Database } from "../../src/infrastructure/supabase/database.types.js";
import { SupabaseVehicleRepository } from "../../src/infrastructure/supabase/supabase-vehicle-repository.js";

type Row = Database["public"]["Tables"]["vehicles"]["Row"];
type Filter = { column: string; value: string };

const vehicle: Vehicle = {
  id: "vehicle-opaque-42",
  businessId: "business-a",
  customerId: "customer-opaque-7",
  brand: "Toyota",
  model: "Corolla",
  year: 2020,
  version: "XEi",
  licensePlate: "ABC1D23",
  mileage: 45890,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-02-03T04:05:06.000Z",
};

const row: Row = {
  id: vehicle.id,
  business_id: vehicle.businessId,
  customer_id: vehicle.customerId ?? null,
  brand: vehicle.brand ?? null,
  model: vehicle.model ?? null,
  year: vehicle.year ?? null,
  version: vehicle.version ?? null,
  license_plate: vehicle.licensePlate ?? null,
  mileage: vehicle.mileage ?? null,
  created_at: vehicle.createdAt,
  updated_at: vehicle.updatedAt,
};

type ReadResult = { data: Row | null; error: Error | null };

class FakeSupabaseClient {
  tableName: string | undefined;
  upsertedRow: Row | undefined;
  conflictTarget: string | undefined;
  filters: Filter[] = [];
  readResult: ReadResult = { data: row, error: null };
  upsertError: Error | null = null;

  from(tableName: string) {
    this.tableName = tableName;
    return {
      upsert: async (value: Row, options: { onConflict: string }) => {
        this.upsertedRow = value;
        this.conflictTarget = options.onConflict;
        return { error: this.upsertError };
      },
      select: (_columns: string) => ({
        eq: (column: string, value: string) => {
          this.filters.push({ column, value });
          return {
            eq: (nextColumn: string, nextValue: string) => {
              this.filters.push({ column: nextColumn, value: nextValue });
              return { maybeSingle: async () => this.readResult };
            },
          };
        },
      }),
    };
  }
}

const repositoryFor = (fake: FakeSupabaseClient) =>
  new SupabaseVehicleRepository(
    fake as unknown as SupabaseClient<Database>,
  );

test("satisfies the VehicleRepository contract", () => {
  const repository: VehicleRepository = repositoryFor(new FakeSupabaseClient());

  assert.equal(typeof repository.findById, "function");
  assert.equal(typeof repository.save, "function");
});

test("save uses vehicles and maps domain fields to database fields", async () => {
  const fake = new FakeSupabaseClient();
  await repositoryFor(fake).save(vehicle);

  assert.equal(fake.tableName, "vehicles");
  assert.deepEqual(fake.upsertedRow, row);
  assert.equal(fake.upsertedRow?.business_id, vehicle.businessId);
  assert.equal(fake.upsertedRow?.customer_id, vehicle.customerId);
  assert.equal(fake.upsertedRow?.license_plate, vehicle.licensePlate);
  assert.equal(fake.upsertedRow?.id, vehicle.id);
  assert.equal(fake.upsertedRow?.year, vehicle.year);
  assert.equal(fake.upsertedRow?.mileage, vehicle.mileage);
  assert.equal(fake.upsertedRow?.created_at, vehicle.createdAt);
  assert.equal(fake.upsertedRow?.updated_at, vehicle.updatedAt);
});

test("save persists absent optional fields as null", async () => {
  const fake = new FakeSupabaseClient();
  const entity: Vehicle = {
    id: "vehicle-minimal",
    businessId: "business-a",
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };

  await repositoryFor(fake).save(entity);

  assert.deepEqual(fake.upsertedRow, {
    id: entity.id,
    business_id: entity.businessId,
    customer_id: null,
    brand: null,
    model: null,
    year: null,
    version: null,
    license_plate: null,
    mileage: null,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  });
});

test("save configures the composite business_id,id conflict target", async () => {
  const fake = new FakeSupabaseClient();
  await repositoryFor(fake).save(vehicle);

  assert.equal(fake.conflictTarget, "business_id,id");
});

test("findById filters by both business_id and id", async () => {
  const fake = new FakeSupabaseClient();

  await repositoryFor(fake).findById("business-b", vehicle.id);

  assert.equal(fake.tableName, "vehicles");
  assert.deepEqual(fake.filters, [
    { column: "business_id", value: "business-b" },
    { column: "id", value: vehicle.id },
  ]);
});

test("findById maps the complete row to Vehicle", async () => {
  const result = await repositoryFor(new FakeSupabaseClient()).findById(
    vehicle.businessId,
    vehicle.id,
  );

  assert.deepEqual(result, vehicle);
});

test("findById omits optional fields whose database values are null", async () => {
  const fake = new FakeSupabaseClient();
  fake.readResult = {
    data: {
      ...row,
      customer_id: null,
      brand: null,
      model: null,
      year: null,
      version: null,
      license_plate: null,
      mileage: null,
    },
    error: null,
  };

  const result = await repositoryFor(fake).findById(
    vehicle.businessId,
    vehicle.id,
  );

  assert.deepEqual(result, {
    id: vehicle.id,
    businessId: vehicle.businessId,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  });
});

test("findById returns null when no record exists", async () => {
  const fake = new FakeSupabaseClient();
  fake.readResult = { data: null, error: null };

  assert.equal(
    await repositoryFor(fake).findById(vehicle.businessId, "missing"),
    null,
  );
});

test("a different business id remains in the lookup filter", async () => {
  const fake = new FakeSupabaseClient();

  await repositoryFor(fake).findById("business-other", vehicle.id);

  assert.deepEqual(fake.filters, [
    { column: "business_id", value: "business-other" },
    { column: "id", value: vehicle.id },
  ]);
});

test("save throws a stable message when Supabase returns an error", async () => {
  const fake = new FakeSupabaseClient();
  fake.upsertError = new Error("provider detail must not escape");

  await assert.rejects(repositoryFor(fake).save(vehicle), {
    message: "Failed to save Vehicle",
  });
});

test("findById throws a stable message when Supabase returns an error", async () => {
  const fake = new FakeSupabaseClient();
  fake.readResult = {
    data: null,
    error: new Error("provider detail must not escape"),
  };

  await assert.rejects(
    repositoryFor(fake).findById(vehicle.businessId, vehicle.id),
    { message: "Failed to load Vehicle" },
  );
});
