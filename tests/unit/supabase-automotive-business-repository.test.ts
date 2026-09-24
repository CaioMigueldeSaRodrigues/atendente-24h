import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutomotiveBusiness } from "../../src/core/domain/entities.js";
import { BusinessType } from "../../src/core/domain/enums.js";
import type { AutomotiveBusinessRepository } from "../../src/core/repositories.js";
import type { Database } from "../../src/infrastructure/supabase/database.types.js";
import { SupabaseAutomotiveBusinessRepository } from "../../src/infrastructure/supabase/supabase-automotive-business-repository.js";

type Row = Database["public"]["Tables"]["automotive_businesses"]["Row"];

const entity: AutomotiveBusiness = {
  id: "business-opaque-42",
  name: "Oficina Central",
  legalName: "Oficina Central Ltda.",
  businessType: BusinessType.WORKSHOP,
  phone: "+5511999999999",
  email: "contato@example.test",
  address: "Rua Um, 10",
  timezone: "America/Sao_Paulo",
  active: true,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-02-03T04:05:06.000Z",
};

const row: Row = {
  id: entity.id,
  name: entity.name,
  legal_name: entity.legalName ?? null,
  business_type: entity.businessType,
  phone: entity.phone ?? null,
  email: entity.email ?? null,
  address: entity.address ?? null,
  timezone: entity.timezone,
  active: entity.active,
  created_at: entity.createdAt,
  updated_at: entity.updatedAt,
};

type QueryResult = { data: Row | null; error: Error | null };

class FakeSupabaseClient {
  tableName: string | undefined;
  upsertedRow: Row | undefined;
  selected = false;
  filteredId: string | undefined;
  upsertError: Error | null = null;
  readResult: QueryResult = { data: row, error: null };

  from(tableName: string) {
    this.tableName = tableName;
    return {
      upsert: async (value: Row) => {
        this.upsertedRow = value;
        return { error: this.upsertError };
      },
      select: (_columns: string) => {
        this.selected = true;
        return {
          eq: (_column: string, value: string) => {
            this.filteredId = value;
            return {
              maybeSingle: async () => this.readResult,
            };
          },
        };
      },
    };
  }
}

const repositoryFor = (fake: FakeSupabaseClient) =>
  new SupabaseAutomotiveBusinessRepository(
    fake as unknown as SupabaseClient<Database>,
  );

test("satisfies the AutomotiveBusinessRepository contract", () => {
  const repository: AutomotiveBusinessRepository = repositoryFor(
    new FakeSupabaseClient(),
  );

  assert.equal(typeof repository.findById, "function");
  assert.equal(typeof repository.save, "function");
});

test("save maps camelCase to snake_case and preserves id and timestamps", async () => {
  const fake = new FakeSupabaseClient();
  await repositoryFor(fake).save(entity);

  assert.equal(fake.tableName, "automotive_businesses");
  assert.deepEqual(fake.upsertedRow, row);
  assert.equal(fake.upsertedRow?.id, entity.id);
  assert.equal(fake.upsertedRow?.created_at, entity.createdAt);
  assert.equal(fake.upsertedRow?.updated_at, entity.updatedAt);
});

test("findById filters by the requested id and maps the row to the domain", async () => {
  const fake = new FakeSupabaseClient();

  const result = await repositoryFor(fake).findById(entity.id);

  assert.equal(fake.tableName, "automotive_businesses");
  assert.equal(fake.selected, true);
  assert.equal(fake.filteredId, entity.id);
  assert.deepEqual(result, entity);
});

test("findById returns null when there is no matching row", async () => {
  const fake = new FakeSupabaseClient();
  fake.readResult = { data: null, error: null };

  assert.equal(await repositoryFor(fake).findById("missing"), null);
});

test("save throws a stable message when Supabase returns an error", async () => {
  const fake = new FakeSupabaseClient();
  fake.upsertError = new Error("provider detail must not escape");

  await assert.rejects(repositoryFor(fake).save(entity), {
    message: "Failed to save AutomotiveBusiness",
  });
});

test("findById throws a stable message when Supabase returns an error", async () => {
  const fake = new FakeSupabaseClient();
  fake.readResult = {
    data: null,
    error: new Error("provider detail must not escape"),
  };

  await assert.rejects(repositoryFor(fake).findById(entity.id), {
    message: "Failed to load AutomotiveBusiness",
  });
});
