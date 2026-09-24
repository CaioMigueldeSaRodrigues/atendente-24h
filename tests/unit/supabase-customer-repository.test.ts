import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Customer } from "../../src/core/domain/entities.js";
import { Channel } from "../../src/core/domain/enums.js";
import type { CustomerRepository } from "../../src/core/repositories.js";
import type { Database } from "../../src/infrastructure/supabase/database.types.js";
import { SupabaseCustomerRepository } from "../../src/infrastructure/supabase/supabase-customer-repository.js";

type Row = Database["public"]["Tables"]["customers"]["Row"];
type Filter = { column: string; value: string };

const customer: Customer = {
  id: "customer-opaque-42",
  businessId: "business-a",
  name: "Ana Silva",
  primaryPhone: "+5511999999999",
  email: "ana@example.test",
  preferredContactChannel: Channel.WHATSAPP,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-02-03T04:05:06.000Z",
};

const row: Row = {
  id: customer.id,
  business_id: customer.businessId,
  name: customer.name ?? null,
  primary_phone: customer.primaryPhone ?? null,
  email: customer.email ?? null,
  preferred_contact_channel: customer.preferredContactChannel ?? null,
  created_at: customer.createdAt,
  updated_at: customer.updatedAt,
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
  new SupabaseCustomerRepository(
    fake as unknown as SupabaseClient<Database>,
  );

test("satisfies the CustomerRepository contract", () => {
  const repository: CustomerRepository = repositoryFor(new FakeSupabaseClient());

  assert.equal(typeof repository.findById, "function");
  assert.equal(typeof repository.save, "function");
});

test("save uses customers and maps domain fields to snake_case", async () => {
  const fake = new FakeSupabaseClient();
  await repositoryFor(fake).save(customer);

  assert.equal(fake.tableName, "customers");
  assert.deepEqual(fake.upsertedRow, row);
  assert.equal(fake.upsertedRow?.business_id, customer.businessId);
  assert.equal(fake.upsertedRow?.id, customer.id);
  assert.equal(fake.upsertedRow?.created_at, customer.createdAt);
  assert.equal(fake.upsertedRow?.updated_at, customer.updatedAt);
});

test("save persists absent optional fields as null", async () => {
  const fake = new FakeSupabaseClient();
  const entity: Customer = {
    id: "customer-minimal",
    businessId: "business-a",
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };

  await repositoryFor(fake).save(entity);

  assert.deepEqual(fake.upsertedRow, {
    id: entity.id,
    business_id: entity.businessId,
    name: null,
    primary_phone: null,
    email: null,
    preferred_contact_channel: null,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  });
});

test("save configures the composite business_id,id conflict target", async () => {
  const fake = new FakeSupabaseClient();
  await repositoryFor(fake).save(customer);

  assert.equal(fake.conflictTarget, "business_id,id");
});

test("findById filters by both business_id and id", async () => {
  const fake = new FakeSupabaseClient();

  await repositoryFor(fake).findById("business-b", customer.id);

  assert.equal(fake.tableName, "customers");
  assert.deepEqual(fake.filters, [
    { column: "business_id", value: "business-b" },
    { column: "id", value: customer.id },
  ]);
});

test("findById maps the database row to Customer", async () => {
  const result = await repositoryFor(new FakeSupabaseClient()).findById(
    customer.businessId,
    customer.id,
  );

  assert.deepEqual(result, customer);
});

test("findById omits optional fields whose database values are null", async () => {
  const fake = new FakeSupabaseClient();
  fake.readResult = {
    data: { ...row, name: null, primary_phone: null, email: null, preferred_contact_channel: null },
    error: null,
  };

  const result = await repositoryFor(fake).findById(
    customer.businessId,
    customer.id,
  );

  assert.deepEqual(result, {
    id: customer.id,
    businessId: customer.businessId,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  });
});

test("findById returns null when no record exists", async () => {
  const fake = new FakeSupabaseClient();
  fake.readResult = { data: null, error: null };

  assert.equal(
    await repositoryFor(fake).findById(customer.businessId, "missing"),
    null,
  );
});

test("a different business id is included in the lookup filter", async () => {
  const fake = new FakeSupabaseClient();

  await repositoryFor(fake).findById("business-other", customer.id);

  assert.deepEqual(fake.filters, [
    { column: "business_id", value: "business-other" },
    { column: "id", value: customer.id },
  ]);
});

test("findById rejects a stored contact channel outside the domain enum", async () => {
  const fake = new FakeSupabaseClient();
  fake.readResult = {
    data: { ...row, preferred_contact_channel: "UNSUPPORTED" },
    error: null,
  };

  await assert.rejects(
    repositoryFor(fake).findById(customer.businessId, customer.id),
    { message: "Failed to load Customer" },
  );
});

test("save throws a stable message when Supabase returns an error", async () => {
  const fake = new FakeSupabaseClient();
  fake.upsertError = new Error("provider detail must not escape");

  await assert.rejects(repositoryFor(fake).save(customer), {
    message: "Failed to save Customer",
  });
});

test("findById throws a stable message when Supabase returns an error", async () => {
  const fake = new FakeSupabaseClient();
  fake.readResult = {
    data: null,
    error: new Error("provider detail must not escape"),
  };

  await assert.rejects(
    repositoryFor(fake).findById(customer.businessId, customer.id),
    { message: "Failed to load Customer" },
  );
});
