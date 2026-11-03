import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PoolClient } from "pg";
import { PostgresDatabase } from "./postgres-database.js";

export const MIGRATIONS = [
  "001_initial_schema.sql",
  "002_appointment_and_handoff_repositories.sql",
  "003_evolution_go_webhook_processing.sql",
  "004_outbound_delivery_outbox.sql",
  "005_stock_checks_read_only.sql",
  "006_business_plan_assignments.sql",
  "007_quote_drafts.sql",
  "008_evolution_go_delivery_truth.sql",
  "009_outbound_delivery_appointment.sql",
  "010_ai_usage.sql",
  "011_groq_gpt_oss_20b_price.sql",
  "012_ai_usage_financial_precision.sql",
  "013_saas_subscriptions.sql",
  "014_payment_transactions.sql",
  "015_payment_webhook_events.sql",
  "016_payment_checkout_urls.sql",
  "017_business_billing_profiles.sql",
  "018_mercadopago_webhook_activation.sql",
  "019_payment_transaction_subscription_index.sql",
  "020_mercadopago_live_mode_guard.sql",
  "021_row_level_security.sql",
  "022_webhook_reply_retry.sql",
  "023_business_profile.sql",
  "024_customer_privacy_notice.sql",
] as const;

// Two instances booting together (or a restart during a deploy) must not apply the same migration twice.
const MIGRATION_LOCK_KEY = 24_000_001;

// The folder sits next to dist (or dist-test), so it is found by walking up from this module, never from the working directory.
export function findMigrationsDirectory(from: string = __dirname): string {
  for (let directory = from; ; directory = dirname(directory)) {
    if (existsSync(join(directory, "migrations", MIGRATIONS[0]))) return join(directory, "migrations");
    if (dirname(directory) === directory) throw new Error("PostgreSQL migrations directory not found");
  }
}

export function applyPostgresMigrations(database: PostgresDatabase): Promise<string[]> {
  return database.withAdvisoryLock(MIGRATION_LOCK_KEY, () => applyMigrations(database));
}

async function applyMigrations(database: PostgresDatabase): Promise<string[]> {
  const applied: string[] = [];
  const directory = findMigrationsDirectory();
  for (const version of MIGRATIONS) {
    const sql = await readFile(join(directory, version), "utf8");
    const didApply = await database.transaction(async (client: PoolClient) => {
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      const prior = await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [version]);
      if (prior.rowCount) return false;
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [version]);
      return true;
    });
    if (didApply) applied.push(version);
  }
  return applied;
}
