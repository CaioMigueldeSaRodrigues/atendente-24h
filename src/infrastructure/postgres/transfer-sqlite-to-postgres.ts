import { DatabaseSync } from "node:sqlite";
import { createConfiguredPostgresDatabase, type PostgresDatabase } from "./postgres-database.js";

const TABLES = [
  "automotive_businesses", "customers", "vehicles", "conversations",
  "evolution_go_conversation_links", "messages", "opportunities", "quote_requests",
  "commercial_events", "assistant_health_events", "evolution_go_webhook_receipts",
  "evolution_go_webhook_claims",
] as const;

export async function transferSqliteToPostgres(filename: string, target: PostgresDatabase): Promise<void> {
  const source = new DatabaseSync(filename, { readOnly: true });
  try {
    source.exec("BEGIN");
    const required = source.prepare("PRAGMA table_info(automotive_businesses)").all();
    if (required.length === 0) throw new Error("Source is not an Atendente SQLite database");
    for (const table of TABLES) {
      const columns = source.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.length) continue;
      const names = columns.map((column) => column.name);
      const rows = source.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      await target.transaction(async (client) => {
        for (const row of rows) {
          const values = names.map((name) => name === "active" && typeof row[name] === "number" ? row[name] === 1 : row[name]);
          const slots = values.map((_, index) => `$${index + 1}`).join(",");
          const quotedColumns = names.map((name) => `"${name}"`).join(",");
          await client.query(
            `INSERT INTO "${table}" (${quotedColumns}) VALUES (${slots}) ON CONFLICT DO NOTHING`,
            values,
          );
        }
      });
      console.log(`${table}: ${rows.length} source rows; existing destination rows preserved`);
    }
  } finally {
    source.close();
  }
}

async function main(): Promise<void> {
  const filename = process.argv[2];
  if (!filename) throw new Error("Usage: node dist/infrastructure/postgres/transfer-sqlite-to-postgres.js <sqlite-file>");
  const target = createConfiguredPostgresDatabase(process.env);
  try { await transferSqliteToPostgres(filename, target); }
  finally { await target.close(); }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "SQLite transfer failed");
    process.exitCode = 1;
  });
}
