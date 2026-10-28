import { parsePostgresPort, type PostgresEnvironment } from "../src/infrastructure/postgres/postgres-database.js";

export function postgresTestConfig(environment: NodeJS.ProcessEnv = process.env): PostgresEnvironment {
  return {
    host: "127.0.0.1",
    port: parsePostgresPort(environment.POSTGRES_TEST_PORT, "POSTGRES_TEST_PORT", 55432),
    database: "atendente24h_test",
    user: "test_user",
    password: environment.POSTGRES_TEST_PASSWORD ?? "",
  };
}

export function postgresTestEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(environment.POSTGRES_TEST_PASSWORD);
}
