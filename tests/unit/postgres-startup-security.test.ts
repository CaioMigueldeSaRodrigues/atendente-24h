import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresDatabase,
  createConfiguredPostgresDatabase,
  isPostgresInsecureLocalEnabled,
} from "../../src/infrastructure/postgres/postgres-database.js";

const localEnvironment: NodeJS.ProcessEnv = {
  PGHOST: "127.0.0.1",
  PGPORT: "55432",
  PGDATABASE: "atendente24h_test",
  PGUSER: "test_user",
  PGPASSWORD: "synthetic-postgres-password",
};

test("POSTGRES_ALLOW_INSECURE_LOCAL=true permits the local loopback configuration", async () => {
  const database = createConfiguredPostgresDatabase({
    ...localEnvironment,
    POSTGRES_ALLOW_INSECURE_LOCAL: "true",
  });
  try {
    assert.equal(isPostgresInsecureLocalEnabled({ POSTGRES_ALLOW_INSECURE_LOCAL: "true" }), true);
    assert.equal(poolOptions(database).ssl, undefined);
  } finally {
    await database.close();
  }
});

test("POSTGRES_ALLOW_INSECURE_LOCAL=true rejects a remote host", () => {
  assert.throws(
    () => createConfiguredPostgresDatabase({
      ...localEnvironment,
      PGHOST: "postgres.example.test",
      POSTGRES_ALLOW_INSECURE_LOCAL: "true",
    }),
    /Insecure PostgreSQL is restricted to loopback and internal hosts/,
  );
});

test("POSTGRES_ALLOW_INSECURE_LOCAL=true accepts an internal host without a dot, such as a compose service", async () => {
  const database = createConfiguredPostgresDatabase({ ...localEnvironment, PGHOST: "db", POSTGRES_ALLOW_INSECURE_LOCAL: "true" });
  try {
    assert.equal(poolOptions(database).ssl, undefined);
  } finally {
    await database.close();
  }
});

test("POSTGRES_ALLOW_INSECURE_LOCAL=true still refuses any host with a dot", () => {
  for (const PGHOST of ["db.internal", "10.0.0.5", "postgres.example.test", "db.supabase.co", "evil/host"]) {
    assert.throws(() => createConfiguredPostgresDatabase({ ...localEnvironment, PGHOST, POSTGRES_ALLOW_INSECURE_LOCAL: "true" }), /Insecure PostgreSQL/, PGHOST);
  }
});

test("without POSTGRES_ALLOW_INSECURE_LOCAL PostgreSQL keeps certificate and hostname validation", async () => {
  const database = createConfiguredPostgresDatabase(localEnvironment);
  try {
    assert.equal(isPostgresInsecureLocalEnabled({}), false);
    assert.deepEqual(poolOptions(database).ssl, { rejectUnauthorized: true });
  } finally {
    await database.close();
  }
});

test("PostgreSQL startup security does not log passwords or credentials", async () => {
  const output: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...values: unknown[]): void => { output.push(values.map(String).join(" ")); };
  console.log = (...values: unknown[]): void => { output.push(values.map(String).join(" ")); };
  try {
    const database = createConfiguredPostgresDatabase({
      ...localEnvironment,
      POSTGRES_ALLOW_INSECURE_LOCAL: "true",
    });
    await database.close();
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  assert.deepEqual(output, []);
  assert.doesNotMatch(output.join("\n"), /synthetic-postgres-password|test_user|atendente24h_test/);
});

test("a pool error reports only its code, never the driver message", async () => {
  const reported: Array<string | undefined> = [];
  const database = new PostgresDatabase({ host: "127.0.0.1", port: 55432, database: "atendente24h_test", user: "test_user", password: "synthetic-postgres-password" }, {
    allowInsecureLocal: true,
    onPoolError: (code) => reported.push(code),
  });
  try {
    const pool = (database as unknown as { pool: { emit: (event: string, error: Error) => void } }).pool;
    pool.emit("error", Object.assign(new Error("terminating connection for user test_user on 127.0.0.1"), { code: "57P01" }));
    pool.emit("error", new Error("no code at all"));
  } finally {
    await database.close();
  }
  assert.deepEqual(reported, ["57P01", undefined]);
});

function poolOptions(database: PostgresDatabase): { ssl?: unknown } {
  return (database as unknown as { pool: { options: { ssl?: unknown } } }).pool.options;
}
