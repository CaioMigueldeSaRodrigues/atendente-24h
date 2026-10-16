import type { PostgresEnvironment } from "../../src/infrastructure/postgres/postgres-database.js";

export function gateEnvironment(): PostgresEnvironment {
  const password = process.env.POSTGRES_TEST_PASSWORD;
  if (!password) throw new Error("Gate 1 requires POSTGRES_TEST_PASSWORD; PostgreSQL real was NOT executed");
  return { host: "127.0.0.1", port: 55432, database: "atendente24h_test", user: "test_user", password };
}
