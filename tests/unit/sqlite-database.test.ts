import assert from "node:assert/strict";
import test from "node:test";
import {
  createSqliteDatabase,
  initializeSqliteSchema,
} from "../../src/infrastructure/sqlite/sqlite-database.js";

test("creates an in-memory database and initializes the schema", () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' ORDER BY name
    `).all().map((table) => ({ ...table }));

    assert.deepEqual(tables, [
      { name: "automotive_businesses" },
      { name: "conversations" },
      { name: "customers" },
      { name: "messages" },
      { name: "vehicles" },
    ]);
  } finally {
    database.close();
  }
});

test("schema initialization is idempotent and preserves data", () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    database.prepare(`
      INSERT INTO automotive_businesses (
        id, name, business_type, timezone, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("business-a", "Oficina", "WORKSHOP", "UTC", 1, "created", "updated");

    initializeSqliteSchema(database);

    const result = database.prepare(
      "SELECT name FROM automotive_businesses WHERE id = ?",
    ).get("business-a");
    assert.deepEqual(result && { ...result }, { name: "Oficina" });
  } finally {
    database.close();
  }
});

test("enables foreign key enforcement", () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    const result = database.prepare("PRAGMA foreign_keys").get();
    assert.equal(result?.foreign_keys, 1);
  } finally {
    database.close();
  }
});
