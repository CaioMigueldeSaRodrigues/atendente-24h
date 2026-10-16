import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { PostgresDatabase } from "./postgres-database.js";

const MIGRATIONS = [
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
] as const;

export async function applyPostgresMigrations(database: PostgresDatabase): Promise<string[]> {
  const applied: string[] = [];
  for (const version of MIGRATIONS) {
    const sql = await readFile(resolve(process.cwd(), "migrations", version), "utf8");
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
