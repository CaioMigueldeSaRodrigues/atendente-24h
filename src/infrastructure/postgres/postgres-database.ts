import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

export type PostgresEnvironment = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export function isPostgresInsecureLocalEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment.POSTGRES_ALLOW_INSECURE_LOCAL?.trim().toLowerCase() === "true";
}

// Loopback or a single-label internal name such as a compose service ("db"); a name with a dot is reached over a network and keeps verified TLS.
export function isInternalPostgresHost(host: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(host) || /^[a-z0-9][a-z0-9_-]*$/i.test(host);
}

export function parsePostgresPort(value: string | undefined, name: string, defaultPort: number): number {
  const portText = value?.trim() || String(defaultPort);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be a valid TCP port`);
  return port;
}

export function postgresConfigFromEnvironment(env: NodeJS.ProcessEnv): PostgresEnvironment {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required for PostgreSQL`);
    return value;
  };
  return {
    host: required("PGHOST"),
    port: parsePostgresPort(env.PGPORT, "PGPORT", 5432),
    database: required("PGDATABASE"),
    user: required("PGUSER"),
    password: required("PGPASSWORD"),
  };
}

export function createConfiguredPostgresDatabase(env: NodeJS.ProcessEnv): PostgresDatabase {
  return new PostgresDatabase(postgresConfigFromEnvironment(env), {
    allowInsecureLocal: isPostgresInsecureLocalEnabled(env),
  });
}

export class PostgresDatabase {
  private readonly transactionContext = new AsyncLocalStorage<PoolClient>();
  private readonly pool: Pool;

  constructor(config: PostgresEnvironment, options: { allowInsecureLocal?: boolean; searchPath?: string; onPoolError?: (code: string | undefined) => void } = {}) {
    if (options.allowInsecureLocal && !isInternalPostgresHost(config.host)) {
      throw new Error("Insecure PostgreSQL is restricted to loopback and internal hosts");
    }
    if (options.searchPath !== undefined && !/^[a-z_][a-z0-9_]*$/.test(options.searchPath)) {
      throw new Error("PostgreSQL searchPath must be a safe identifier");
    }
    const poolConfig: PoolConfig = {
      ...config,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      ...(options.allowInsecureLocal ? {} : { ssl: { rejectUnauthorized: true } }),
      ...(options.searchPath === undefined ? {} : { options: `-c search_path=${options.searchPath}` }),
      application_name: "atendente-24h",
    };
    this.pool = new Pool(poolConfig);
    // Only the error code leaves here: driver diagnostics can include connection data.
    this.pool.on("error", (error) => {
      const code = (error as { code?: unknown }).code;
      try { options.onPoolError?.(typeof code === "string" ? code : undefined); } catch { /* logging must not throw */ }
    });
  }

  query<Row extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []) {
    const client = this.transactionContext.getStore();
    return client ? client.query<Row>(text, [...values]) : this.pool.query<Row>(text, [...values]);
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const existing = this.transactionContext.getStore();
    if (existing) return operation(existing);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.transactionContext.run(client, () => operation(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // Holds a session advisory lock on a dedicated connection while the operation runs, so it may use the pool freely.
  async withAdvisoryLock<T>(key: number, operation: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let unlocked = false;
    try {
      await client.query("SELECT pg_advisory_lock($1)", [key]);
      try {
        return await operation();
      } finally {
        unlocked = await client.query("SELECT pg_advisory_unlock($1)", [key]).then(() => true, () => false);
      }
    } finally {
      // A connection that could not unlock is destroyed, which drops the lock with its session.
      client.release(unlocked ? undefined : true);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
