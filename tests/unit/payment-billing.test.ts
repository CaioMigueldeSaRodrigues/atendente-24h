import assert from "node:assert/strict";
import test from "node:test";
import { AdminPlan } from "../../src/core/admin-plan-entitlement.js";
import { BillingCycle, getPaymentCatalogEntry, listPaymentCatalog } from "../../src/core/payment-catalog.js";
import { MockPaymentProvider } from "../../src/integrations/payment/mock-payment-provider.js";
import { PaymentTransactionStatus, type PaymentTransaction } from "../../src/core/payment-transaction.js";
import { SubscriptionService } from "../../src/core/subscription-service.js";
import type { PaymentProvider } from "../../src/core/payment-provider.js";
import type { Subscription, SubscriptionRepository } from "../../src/core/subscription.js";
import { readPaymentEnvironment } from "../../src/config/payment-environment.js";

test("catalog contains the six commercial combinations in integer BRL cents", () => {
  assert.equal(listPaymentCatalog().length, 6);
  assert.deepEqual(
    listPaymentCatalog().map(({ plan, billingCycle, subscriptionAmountCents, setupFeeCents, currency }) => ({ plan, billingCycle, subscriptionAmountCents, setupFeeCents, currency })),
    [
      { plan: AdminPlan.BASIC, billingCycle: BillingCycle.MONTHLY, subscriptionAmountCents: 39_700, setupFeeCents: 49_000, currency: "BRL" },
      { plan: AdminPlan.INTERMEDIATE, billingCycle: BillingCycle.MONTHLY, subscriptionAmountCents: 69_700, setupFeeCents: 89_000, currency: "BRL" },
      { plan: AdminPlan.ADVANCED, billingCycle: BillingCycle.MONTHLY, subscriptionAmountCents: 119_700, setupFeeCents: 149_000, currency: "BRL" },
      { plan: AdminPlan.BASIC, billingCycle: BillingCycle.ANNUAL, subscriptionAmountCents: 397_000, setupFeeCents: 49_000, currency: "BRL" },
      { plan: AdminPlan.INTERMEDIATE, billingCycle: BillingCycle.ANNUAL, subscriptionAmountCents: 697_000, setupFeeCents: 89_000, currency: "BRL" },
      { plan: AdminPlan.ADVANCED, billingCycle: BillingCycle.ANNUAL, subscriptionAmountCents: 1_197_000, setupFeeCents: 149_000, currency: "BRL" },
    ],
  );
});

test("invalid plan and billing cycle are rejected by the server-side catalog", () => {
  assert.throws(() => getPaymentCatalogEntry("PRO", BillingCycle.MONTHLY), /Invalid payment plan or billing cycle/);
  assert.throws(() => getPaymentCatalogEntry(AdminPlan.BASIC, "WEEKLY"), /Invalid payment plan or billing cycle/);
});

test("subscription service ignores a tampered amount and persists setup and subscription separately", async () => {
  const subscriptions = new MemorySubscriptions();
  const transactions: PaymentTransaction[] = [];
  const provider = new MockPaymentProvider();
  let sequence = 0;
  const service = new SubscriptionService({
    subscriptionRepository: subscriptions,
    paymentTransactionRepository: {
      save: async (transaction) => { transactions.push(transaction); },
      findByBusinessAndIdempotencyKey: async () => null,
      findByProviderPaymentId: async () => null,
      listBySubscription: async (_businessId, subscriptionId) => transactions.filter((transaction) => transaction.subscriptionId === subscriptionId),
    },
    paymentProvider: provider,
    generateId: (prefix) => `${prefix}-${++sequence}`,
    generateIdempotencyKey: () => "generated-key",
    now: () => "2026-10-15T12:00:00.000Z",
  });

  const result = await service.start({ businessId: "business-a", plan: AdminPlan.INTERMEDIATE, billingCycle: BillingCycle.ANNUAL, payerEmail: "billing@business-a.test", idempotencyKey: "request-a", ...({ amountCents: 1 } as Record<string, unknown>) } as never);
  assert.equal(result.subscription.subscriptionAmountCents, 697_000);
  assert.equal(result.subscription.setupFeeCents, 89_000);
  assert.equal(result.transactions.length, 2);
  assert.deepEqual(result.transactions.map((transaction) => [transaction.type, transaction.amountCents, transaction.status]), [
    ["SETUP_FEE", 89_000, PaymentTransactionStatus.PENDING],
    ["SUBSCRIPTION", 697_000, PaymentTransactionStatus.PENDING],
  ]);
  assert.equal(subscriptions.items[0]?.status, "PENDING");
});

test("same idempotency key is tenant-scoped and does not mix two businesses", async () => {
  const subscriptions = new MemorySubscriptions();
  const transactions: PaymentTransaction[] = [];
  let providerCalls = 0;
  let sequence = 0;
  const provider: PaymentProvider = {
    name: "mock",
    createSubscriptionIntent: async () => { providerCalls += 1; return { status: "PENDING", providerSubscriptionId: `provider-sub-${providerCalls}` }; },
    createSetupFeeIntent: async () => { providerCalls += 1; return { status: "PENDING", providerPaymentId: `provider-pay-${providerCalls}` }; },
  };
  const service = new SubscriptionService({
    subscriptionRepository: subscriptions,
    paymentTransactionRepository: {
      save: async (transaction) => { const index = transactions.findIndex((current) => current.id === transaction.id); if (index < 0) transactions.push(transaction); else transactions[index] = transaction; },
      findByBusinessAndIdempotencyKey: async () => null,
      findByProviderPaymentId: async () => null,
      listBySubscription: async (_businessId, subscriptionId) => transactions.filter((transaction) => transaction.subscriptionId === subscriptionId),
    },
    paymentProvider: provider,
    generateId: (prefix) => `${prefix}-${++sequence}`,
    generateIdempotencyKey: () => "unused",
    now: () => "2026-10-15T12:00:00.000Z",
  });
  const first = await service.start({ businessId: "business-a", plan: AdminPlan.BASIC, billingCycle: BillingCycle.MONTHLY, payerEmail: "billing@business-a.test", idempotencyKey: "same-key" });
  const retry = await service.start({ businessId: "business-a", plan: AdminPlan.ADVANCED, billingCycle: BillingCycle.ANNUAL, payerEmail: "billing@business-a.test", idempotencyKey: "same-key" });
  const otherTenant = await service.start({ businessId: "business-b", plan: AdminPlan.BASIC, billingCycle: BillingCycle.MONTHLY, payerEmail: "billing@business-b.test", idempotencyKey: "same-key" });
  assert.equal(retry.reused, true);
  assert.equal(retry.subscription.id, first.subscription.id);
  assert.equal(otherTenant.reused, false);
  assert.equal(subscriptions.items.length, 2);
  assert.equal(providerCalls, 4);
});

test("payment mode defaults to mock and Mercado Pago requires an explicit environment", () => {
  assert.deepEqual(readPaymentEnvironment({}), { mode: "mock" });
  assert.throws(() => readPaymentEnvironment({ PAYMENT_MODE: "invalid" }), /PAYMENT_MODE must be mock or mercadopago/);
  assert.throws(() => readPaymentEnvironment({ PAYMENT_MODE: "mercadopago" }), /MERCADO_PAGO_ENVIRONMENT/);
  assert.throws(() => readPaymentEnvironment({ PAYMENT_MODE: "mercadopago", MERCADO_PAGO_ENVIRONMENT: "sandbox" }), /MERCADO_PAGO_ENVIRONMENT must be test or production/);
  assert.throws(() => readPaymentEnvironment({ PAYMENT_MODE: "mercadopago", MERCADO_PAGO_ENVIRONMENT: "test", MERCADO_PAGO_ACCESS_TOKEN: "token", MERCADO_PAGO_WEBHOOK_SECRET: "secret", MERCADO_PAGO_BACK_URL: "http://example.test/checkout" }), /MERCADO_PAGO_BACK_URL must be a valid HTTPS URL/);
  assert.deepEqual(readPaymentEnvironment({ PAYMENT_MODE: "mercadopago", MERCADO_PAGO_ENVIRONMENT: "test", MERCADO_PAGO_ACCESS_TOKEN: "token", MERCADO_PAGO_WEBHOOK_SECRET: "secret", MERCADO_PAGO_BACK_URL: "https://example.test/checkout" }), {
    mode: "mercadopago", mercadoPagoEnvironment: "test", mercadoPagoAccessToken: "token", mercadoPagoWebhookSecret: "secret", mercadoPagoBackUrl: "https://example.test/checkout",
  });
});

class MemorySubscriptions implements SubscriptionRepository {
  readonly items: Subscription[] = [];
  async save(subscription: Subscription): Promise<void> {
    const index = this.items.findIndex((current) => current.id === subscription.id);
    if (index < 0) this.items.push(subscription); else this.items[index] = subscription;
  }
  async findById(businessId: string, subscriptionId: string): Promise<Subscription | null> {
    return this.items.find((subscription) => subscription.businessId === businessId && subscription.id === subscriptionId) ?? null;
  }
  async findByBusinessAndIdempotencyKey(businessId: string, idempotencyKey: string): Promise<Subscription | null> {
    return this.items.find((subscription) => subscription.businessId === businessId && subscription.idempotencyKey === idempotencyKey) ?? null;
  }
  async findByProviderSubscriptionId(provider: string, providerSubscriptionId: string): Promise<Subscription | null> {
    return this.items.find((subscription) => subscription.provider === provider && subscription.providerSubscriptionId === providerSubscriptionId) ?? null;
  }
  async findByExternalReference(provider: string, externalReference: string): Promise<Subscription | null> {
    return this.items.find((subscription) => subscription.provider === provider && subscription.externalReference === externalReference) ?? null;
  }
}
