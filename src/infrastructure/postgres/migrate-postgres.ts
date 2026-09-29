import { createConfiguredPostgresDatabase } from "./postgres-database.js";
import { applyPostgresMigrations } from "./postgres-migrations.js";

async function main(): Promise<void> {
  const database = createConfiguredPostgresDatabase(process.env);
  try {
    const applied = await applyPostgresMigrations(database);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No pending migrations");
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "PostgreSQL migration failed");
  process.exitCode = 1;
});
