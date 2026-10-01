import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { PostgresDatabase } from "./postgres-database.js";

const MIGRATIONS = [
  "001_initial_schema.sql",
  "002_appointment_and_handoff_repositories.sql",
  "003_evolution_go_webhook_processing.sql",
  "004_outbound_delivery_outbox.sql",
] as const;

export async function applyPostgresMigrations(database: PostgresDatabase): Promise<string[]> {
  const applied: string[] = [];
  for (const version of MIGRATIONS) {
    const sql = await readFile(resolve(process.cwd(), "migrations", version), "utf8");
    const didApply = await database.transaction(async (client: PoolClient) => {
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      const prior = await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [version]);
      if (prior.rowCount) return false;
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [version]);
      return true;
    });
    if (didApply) applied.push(version);
  }
  return applied;
}
