import type { PostgresEnvironment } from "../../src/infrastructure/postgres/postgres-database.js";
import { postgresTestConfig } from "../postgres-test-environment.js";

export function gateEnvironment(): PostgresEnvironment {
  if (!process.env.POSTGRES_TEST_PASSWORD) throw new Error("Gate 1 requires POSTGRES_TEST_PASSWORD; PostgreSQL real was NOT executed");
  return postgresTestConfig();
}
