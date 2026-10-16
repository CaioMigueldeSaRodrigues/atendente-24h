import assert from "node:assert/strict";
import test from "node:test";
import { AdminPlan } from "../../src/core/admin-plan-entitlement.js";
import { MercadoPagoWebhookEventType, MercadoPagoWebhookService } from "../../src/core/mercado-pago-webhook-service.js";
import type { PaymentProviderReadApi, ProviderAuthorizedPaymentResource, ProviderPaymentResource, ProviderSubscriptionResource } from "../../src/core/payment-provider.js";
import { PaymentTransactionType } from "../../src/core/payment-transaction.js";
import { PaymentWebhookProcessingStatus } from "../../src/core/payment-webhook-event.js";
import { SubscriptionStatus } from "../../src/core/subscription.js";
import { applyPostgresMigrations } from "../../src/infrastructure/postgres/postgres-migrations.js";
import { PostgresBusinessPlanAssignmentRepository } from "../../src/infrastructure/postgres/postgres-business-plan-assignment-repository.js";
import { PostgresDatabase, type PostgresEnvironment } from "../../src/infrastructure/postgres/postgres-database.js";
import { PostgresPaymentTransactionRepository } from "../../src/infrastructure/postgres/postgres-payment-transaction-repository.js";
import { PostgresPaymentWebhookEventRepository } from "../../src/infrastructure/postgres/postgres-payment-webhook-event-repository.js";
import { PostgresSubscriptionRepository } from "../../src/infrastructure/postgres/postgres-subscription-repository.js";

const config: PostgresEnvironment = {
  host: "127.0.0.1",
  port: 55432,
  database: "atendente24h_test",
  user: "test_user",
  password: process.env.POSTGRES_TEST_PASSWORD ?? "",
};
const enabled = Boolean(process.env.POSTGRES_TEST_PASSWORD);

test("PostgreSQL Mercado Pago webhook claims replay and activates entitlement transactionally", { skip: !enabled }, async () => {
  const admin = new PostgresDatabase(config, { allowInsecureLocal: true });
  const schema = `att24_mp_webhook_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const database = new PostgresDatabase(config, { allowInsecureLocal: true, searchPath: schema });
  try {
    await applyPostgresMigrations(database);
    await database.query("INSERT INTO automotive_businesses(id,name,business_type,timezone,active,created_at,updated_at) VALUES('webhook-business-a','A','OTHER','UTC',true,now(),now()),('webhook-business-b','B','OTHER','UTC',true,now(),now())");
    const subscriptions = new PostgresSubscriptionRepository(database);
    const transactions = new PostgresPaymentTransactionRepository(database);
    const subscription = {
      id: "subscription-webhook-a", businessId: "webhook-business-a", plan: AdminPlan.INTERMEDIATE, billingCycle: "MONTHLY" as const, catalogVersion: "test",
      status: SubscriptionStatus.PENDING, provider: "mercadopago", providerSubscriptionId: "preapproval-a", providerStatus: "pending",
      externalReference: "subscription:subscription-webhook-a", subscriptionAmountCents: 69700, setupFeeCents: 89000, currency: "BRL" as const,
      idempotencyKey: "subscription-webhook-a:intent", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
    };
    await subscriptions.save(subscription);
    await transactions.save({ id: "setup-webhook-a", businessId: subscription.businessId, subscriptionId: subscription.id, provider: "mercadopago", providerPaymentId: "preference-a", type: PaymentTransactionType.SETUP_FEE, amountCents: 89000, currency: "BRL", status: "PENDING", idempotencyKey: "subscription-webhook-a:setup", createdAt: subscription.createdAt, updatedAt: subscription.createdAt });
    await transactions.save({ id: "recurring-webhook-a", businessId: subscription.businessId, subscriptionId: subscription.id, provider: "mercadopago", providerSubscriptionId: "preapproval-a", type: PaymentTransactionType.SUBSCRIPTION, amountCents: 69700, currency: "BRL", status: "PENDING", idempotencyKey: "subscription-webhook-a:subscription", createdAt: subscription.createdAt, updatedAt: subscription.createdAt });
    const provider = new IntegrationProvider();
    const events = new PostgresPaymentWebhookEventRepository(database);
    const service = new MercadoPagoWebhookService({
      webhookEvents: events, subscriptions, transactions, assignments: new PostgresBusinessPlanAssignmentRepository(database), provider,
      transaction: { run: (operation) => database.transaction(async () => operation()) }, now: () => "2026-10-15T12:00:00.000Z", generateId: (prefix) => `${prefix}-future`,
    });
    await service.process({ event: event("setup-event", "payment-setup"), eventType: MercadoPagoWebhookEventType.PAYMENT, resourceId: "payment-setup" });
    await service.process({ event: event("subscription-event", "preapproval-a"), eventType: MercadoPagoWebhookEventType.SUBSCRIPTION_PREAPPROVAL, resourceId: "preapproval-a" });
    await service.process({ event: event("recurring-event", "authorized-a"), eventType: MercadoPagoWebhookEventType.SUBSCRIPTION_AUTHORIZED_PAYMENT, resourceId: "authorized-a" });
    assert.equal((await subscriptions.findById(subscription.businessId, subscription.id))?.status, SubscriptionStatus.ACTIVE);
    assert.equal((await database.query("SELECT count(*)::int AS count FROM business_plan_assignments WHERE business_id=$1 AND status='ACTIVE'", [subscription.businessId])).rows[0]?.count, 1);
    const replay = await service.process({ event: event("recurring-event", "authorized-a"), eventType: MercadoPagoWebhookEventType.SUBSCRIPTION_AUTHORIZED_PAYMENT, resourceId: "authorized-a" });
    assert.equal(replay.status, "duplicate");
    assert.equal((await database.query("SELECT count(*)::int AS count FROM business_plan_assignments WHERE business_id=$1", [subscription.businessId])).rows[0]?.count, 1);
    assert.equal((await events.findByProviderEventId("mercadopago", "recurring-event"))?.processingStatus, PaymentWebhookProcessingStatus.PROCESSED);
    assert.equal((await transactions.listBySubscription(subscription.businessId, subscription.id)).filter((item) => item.providerPaymentId === "payment-recurring").length, 1);
  } finally {
    await database.close();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.close();
  }
});

function event(providerEventId: string, resourceId: string) {
  return { id: `row-${providerEventId}`, provider: "mercadopago", providerEventId, providerRequestId: `request-${providerEventId}`, resourceId, eventType: "payment", payloadHash: `hash-${providerEventId}`, processingStatus: PaymentWebhookProcessingStatus.RECEIVED, receivedAt: "2026-10-15T12:00:00.000Z" };
}

class IntegrationProvider implements PaymentProviderReadApi {
  async getSubscription(id: string): Promise<ProviderSubscriptionResource> { return { id, status: "authorized", externalReference: "subscription:subscription-webhook-a", autoRecurring: { transactionAmountCents: 69700, currencyId: "BRL", frequency: 1, frequencyType: "months" } }; }
  async getPayment(id: string): Promise<ProviderPaymentResource> {
    return id === "payment-setup"
      ? { id, status: "approved", statusDetail: "accredited", externalReference: "setup:subscription-webhook-a", transactionAmountCents: 89000, currencyId: "BRL" }
      : { id, status: "approved", statusDetail: "accredited", externalReference: "subscription:subscription-webhook-a", transactionAmountCents: 69700, currencyId: "BRL" };
  }
  async getAuthorizedPayment(id: string): Promise<ProviderAuthorizedPaymentResource> { return { id, preapprovalId: "preapproval-a", paymentId: "payment-recurring", externalReference: "subscription:subscription-webhook-a" }; }
}
