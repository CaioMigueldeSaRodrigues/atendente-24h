import { createConfiguredPostgresDatabase } from "./postgres-database.js";

async function main(): Promise<void> {
  const database = createConfiguredPostgresDatabase(process.env);
  try {
    const result = await database.query<{ current_database: string; current_user: string; ssl: string }>(`
      SELECT current_database(), current_user,
        (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())::text AS ssl
    `);
    const row = result.rows[0];
    if (!row?.ssl || row.ssl !== "true") throw new Error("PostgreSQL TLS is not active");
    console.log(`Connected to ${row.current_database} as ${row.current_user}; TLS verified`);
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "PostgreSQL connection check failed");
  process.exitCode = 1;
});
