import { createConfiguredPostgresDatabase } from "./postgres-database.js";

async function main(): Promise<void> {
  const database = createConfiguredPostgresDatabase(process.env);
  try {
    const result = await database.query<{ current_database: string; current_user: string }>(
      "SELECT current_database(), current_user",
    );
    const row = result.rows[0];
    if (!row?.current_database || !row.current_user) {
      throw new Error("PostgreSQL connection check returned an invalid response");
    }
    console.log(
      `Connected to ${row.current_database} as ${row.current_user}; TLS certificate validation configured`,
    );
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "PostgreSQL connection check failed");
  process.exitCode = 1;
});
