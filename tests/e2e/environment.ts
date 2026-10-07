import type { PostgresEnvironment } from "../../src/infrastructure/postgres/postgres-database.js";

export function gateEnvironment(): PostgresEnvironment {
  const read = (name: string): string => {
    const value = process.env[`POSTGRES_TEST_${name}`];
    if (!value) throw new Error(`Gate 1 requires POSTGRES_TEST_${name}; PostgreSQL real was NOT executed`);
    return value;
  };
  const config = { host: read("HOST"), port: Number(read("PORT")), database: read("DATABASE"), user: read("USER"), password: read("PASSWORD") };
  if (!["127.0.0.1", "::1", "localhost"].includes(config.host)) throw new Error("Gate 1 permits only disposable loopback PostgreSQL; remote databases are forbidden");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("Invalid POSTGRES_TEST_PORT");
  return config;
}
