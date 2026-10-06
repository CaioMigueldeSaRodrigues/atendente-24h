import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

export type PostgresEnvironment = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export function postgresConfigFromEnvironment(env: NodeJS.ProcessEnv): PostgresEnvironment {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required for PostgreSQL`);
    return value;
  };
  const portText = env.PGPORT?.trim() || "5432";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PGPORT must be a valid TCP port");
  return {
    host: required("PGHOST"),
    port,
    database: required("PGDATABASE"),
    user: required("PGUSER"),
    password: required("PGPASSWORD"),
  };
}

export function createConfiguredPostgresDatabase(env: NodeJS.ProcessEnv): PostgresDatabase {
  return new PostgresDatabase(postgresConfigFromEnvironment(env), {
    allowInsecureLocal: env.POSTGRES_ALLOW_INSECURE_LOCAL === "true",
  });
}

export class PostgresDatabase {
  private readonly transactionContext = new AsyncLocalStorage<PoolClient>();
  private readonly pool: Pool;

  constructor(config: PostgresEnvironment, options: { allowInsecureLocal?: boolean; searchPath?: string } = {}) {
    if (options.allowInsecureLocal && !["localhost", "127.0.0.1", "::1"].includes(config.host)) {
      throw new Error("Insecure PostgreSQL is restricted to loopback hosts");
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
    this.pool.on("error", () => {
      // Pool errors are deliberately not logged because driver diagnostics can include connection data.
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

  async close(): Promise<void> {
    await this.pool.end();
  }
}
