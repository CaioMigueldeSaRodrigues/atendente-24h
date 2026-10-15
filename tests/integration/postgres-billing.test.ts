import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase, type PostgresEnvironment } from "../../src/infrastructure/postgres/postgres-database.js";
import { applyPostgresMigrations } from "../../src/infrastructure/postgres/postgres-migrations.js";
import { PostgresPaymentTransactionRepository } from "../../src/infrastructure/postgres/postgres-payment-transaction-repository.js";
import { PostgresPaymentWebhookEventRepository } from "../../src/infrastructure/postgres/postgres-payment-webhook-event-repository.js";
import { PostgresSubscriptionRepository } from "../../src/infrastructure/postgres/postgres-subscription-repository.js";
import { SubscriptionService } from "../../src/core/subscription-service.js";
import { MockPaymentProvider } from "../../src/integrations/payment/mock-payment-provider.js";
import { PaymentWebhookProcessingStatus } from "../../src/core/payment-webhook-event.js";

const config: PostgresEnvironment = {
  host: process.env.POSTGRES_TEST_HOST ?? "",
  port: Number(process.env.POSTGRES_TEST_PORT ?? 5432),
  database: process.env.POSTGRES_TEST_DATABASE ?? "",
  user: process.env.POSTGRES_TEST_USER ?? "",
  password: process.env.POSTGRES_TEST_PASSWORD ?? "",
};
const enabled = Boolean(
  process.env.POSTGRES_TEST_HOST
  && process.env.POSTGRES_TEST_DATABASE
  && /(?:test|ci|dev)/i.test(process.env.POSTGRES_TEST_DATABASE)
  && process.env.POSTGRES_TEST_USER
  && process.env.POSTGRES_TEST_PASSWORD,
);

test("PostgreSQL billing foundation isolates tenants, persists intents, and keeps entitlement unchanged", { skip: !enabled }, async () => {
  const admin = new PostgresDatabase(config, { allowInsecureLocal: true });
  const schema = `att24_billing_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const database = new PostgresDatabase(config, { allowInsecureLocal: true, searchPath: schema });
  try {
    const applied = await applyPostgresMigrations(database);
    assert.deepEqual(applied.slice(-3), ["013_saas_subscriptions.sql", "014_payment_transactions.sql", "015_payment_webhook_events.sql"]);
    for (const businessId of ["billing-business-a", "billing-business-b"]) {
      await database.query("INSERT INTO automotive_businesses(id,name,business_type,timezone,active,created_at,updated_at) VALUES($1,$1,'OTHER','UTC',true,$2,$2)", [businessId, "2026-10-15T00:00:00Z"]);
    }
    let sequence = 0;
    const subscriptions = new PostgresSubscriptionRepository(database);
    const transactions = new PostgresPaymentTransactionRepository(database);
    const service = new SubscriptionService({
      subscriptionRepository: subscriptions,
      paymentTransactionRepository: transactions,
      paymentProvider: new MockPaymentProvider(),
      generateId: (prefix) => `${prefix}-${++sequence}`,
      generateIdempotencyKey: () => `generated-${++sequence}`,
      now: () => "2026-10-15T12:00:00.000Z",
    });
    const a = await service.start({ businessId: "billing-business-a", plan: "INTERMEDIATE", billingCycle: "MONTHLY", idempotencyKey: "tenant-a-key" });
    const b = await service.start({ businessId: "billing-business-b", plan: "ADVANCED", billingCycle: "ANNUAL", idempotencyKey: "tenant-b-key" });
    const retry = await service.start({ businessId: "billing-business-a", plan: "BASIC", billingCycle: "ANNUAL", idempotencyKey: "tenant-a-key" });
    assert.equal(retry.reused, true);
    assert.equal(retry.subscription.id, a.subscription.id);
    assert.equal(a.subscription.subscriptionAmountCents, 69_700);
    assert.equal(a.subscription.setupFeeCents, 89_000);
    assert.equal(b.subscription.subscriptionAmountCents, 1_197_000);
    assert.equal(b.subscription.setupFeeCents, 149_000);
    assert.deepEqual((await transactions.listBySubscription("billing-business-a", a.subscription.id)).map((item) => [item.type, item.amountCents]), [["SETUP_FEE", 89_000], ["SUBSCRIPTION", 69_700]]);
    assert.deepEqual((await transactions.listBySubscription("billing-business-b", b.subscription.id)).map((item) => [item.type, item.amountCents]), [["SETUP_FEE", 149_000], ["SUBSCRIPTION", 1_197_000]]);
    assert.equal((await database.query("SELECT count(*)::int AS count FROM business_plan_assignments")).rows[0]?.count, 0);

    const events = new PostgresPaymentWebhookEventRepository(database);
    const event = {
      id: "webhook-1", businessId: "billing-business-a", provider: "mock", providerEventId: "event-1",
      providerRequestId: "request-1", resourceId: a.subscription.id, eventType: "subscription.updated",
      payloadHash: "hash", processingStatus: PaymentWebhookProcessingStatus.RECEIVED,
      receivedAt: "2026-10-15T12:00:00.000Z",
    } as const;
    await events.save(event);
    assert.equal((await events.findByProviderEventId("mock", "event-1"))?.businessId, "billing-business-a");
    await events.update({ ...event, processingStatus: PaymentWebhookProcessingStatus.PROCESSED, processedAt: "2026-10-15T12:01:00.000Z" });
    assert.equal((await events.findByProviderEventId("mock", "event-1"))?.processingStatus, PaymentWebhookProcessingStatus.PROCESSED);
  } finally {
    await database.close();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.close();
  }
});
