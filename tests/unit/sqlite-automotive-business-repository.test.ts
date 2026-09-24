import assert from "node:assert/strict";
import test from "node:test";
import type { AutomotiveBusiness } from "../../src/core/domain/entities.js";
import { BusinessType } from "../../src/core/domain/enums.js";
import type { AutomotiveBusinessRepository } from "../../src/core/repositories.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";

const entity: AutomotiveBusiness = {
  id: "business-a",
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

const withRepository = async (
  run: (repository: SqliteAutomotiveBusinessRepository, database: ReturnType<typeof createSqliteDatabase>) => Promise<void>,
) => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await run(new SqliteAutomotiveBusinessRepository(database), database);
  } finally {
    database.close();
  }
};

test("satisfies AutomotiveBusinessRepository and round-trips a business", async () => {
  await withRepository(async (repository) => {
    const contract: AutomotiveBusinessRepository = repository;
    await contract.save(entity);
    assert.deepEqual(await contract.findById(entity.id), entity);
  });
});

test("updates an existing business without changing its id", async () => {
  await withRepository(async (repository) => {
    await repository.save(entity);
    const updated = { ...entity, name: "Nome atualizado", updatedAt: "2026-03-01T00:00:00.000Z" };
    await repository.save(updated);

    assert.deepEqual(await repository.findById(entity.id), updated);
  });
});

test("round-trips optional fields as omitted values when absent", async () => {
  await withRepository(async (repository) => {
    const minimal: AutomotiveBusiness = {
      id: "business-minimal",
      name: "Oficina",
      businessType: BusinessType.OTHER,
      timezone: "UTC",
      active: false,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
    await repository.save(minimal);
    assert.deepEqual(await repository.findById(minimal.id), minimal);
  });
});

test("loads a valid BusinessType", async () => {
  await withRepository(async (repository) => {
    await repository.save(entity);
    assert.equal((await repository.findById(entity.id))?.businessType, BusinessType.WORKSHOP);
  });
});

test("rejects an invalid stored BusinessType with a stable error", async () => {
  await withRepository(async (repository, database) => {
    await repository.save(entity);
    database.prepare("UPDATE automotive_businesses SET business_type = ? WHERE id = ?")
      .run("INVALID", entity.id);

    await assert.rejects(repository.findById(entity.id), {
      message: "Failed to load AutomotiveBusiness",
    });
  });
});
