import assert from "node:assert/strict";
import test from "node:test";
import type { PaymentProvider } from "../../src/core/payment-provider.js";
import { PaymentTransactionStatus, type PaymentTransaction, type PaymentTransactionRepository } from "../../src/core/payment-transaction.js";
import { SubscriptionService } from "../../src/core/subscription-service.js";
import type { Subscription, SubscriptionRepository } from "../../src/core/subscription.js";
import { runMercadoPagoSandboxSmoke, formatSandboxSmokeReport, redactSandboxError, sandboxPostgresConfig, sandboxSmokeIdempotencyKey } from "../../src/integrations/payment/mercado-pago-sandbox-runner.js";
import type { PostgresDatabase } from "../../src/infrastructure/postgres/postgres-database.js";

test("sandbox smoke aborts before database or provider work without explicit confirmation", async () => {
  const environment = smokeEnvironment({ MERCADO_PAGO_SANDBOX_CONFIRM: "NO" });
  await assert.rejects(
    runMercadoPagoSandboxSmoke(environment, {
      createDatabase: () => { throw new Error("database must not be opened"); },
      createPaymentProvider: () => { throw new Error("provider must not be created"); },
    }),
    /MERCADO_PAGO_SANDBOX_CONFIRM=YES/,
  );
});

test("sandbox smoke refuses production before any external work", async () => {
  const environment = smokeEnvironment({ MERCADO_PAGO_ENVIRONMENT: "production" });
  await assert.rejects(
    runMercadoPagoSandboxSmoke(environment, {
      createDatabase: () => { throw new Error("database must not be opened"); },
      createPaymentProvider: () => { throw new Error("provider must not be created"); },
    }),
    /refuses MERCADO_PAGO_ENVIRONMENT=production/,
  );
});

test("dry-run validates the dedicated business and payer without creating a provider intent", async () => {
  const environment = smokeEnvironment({ MERCADO_PAGO_SANDBOX_DRY_RUN: "true", MERCADO_PAGO_TEST_PAYER_EMAIL: " PAYER@EXAMPLE.TEST " });
  delete environment.MERCADO_PAGO_ACCESS_TOKEN;
  delete environment.MERCADO_PAGO_WEBHOOK_SECRET;
  delete environment.MERCADO_PAGO_BACK_URL;
  let providerCreated = false;
  const result = await runMercadoPagoSandboxSmoke(environment, {
    createDatabase: () => fakeSandboxDatabase(),
    migrate: async () => [],
    createPaymentProvider: () => { providerCreated = true; throw new Error("provider must not be created in dry-run"); },
  });
  assert.equal(providerCreated, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.status, "DRY_RUN");
  assert.equal(result.plan, "INTERMEDIATE");
  assert.equal(result.billingCycle, "MONTHLY");
  assert.equal(result.subscriptionId, undefined);
  assert.deepEqual(sandboxPostgresConfig({ POSTGRES_TEST_PASSWORD: "local-test-password" }), {
    host: "127.0.0.1", port: 55432, database: "atendente24h_test", user: "test_user", password: "local-test-password",
  });
  assert.deepEqual(sandboxPostgresConfig({ POSTGRES_TEST_PORT: "15432", POSTGRES_TEST_PASSWORD: "local-test-password" }).port, 15432);
  assert.throws(() => sandboxPostgresConfig({ POSTGRES_TEST_PORT: "not-a-port" }), /POSTGRES_TEST_PORT must be a valid TCP port/);
});

test("real sandbox smoke still requires complete provider credentials", async () => {
  const missingCredentialCases = [
    ["MERCADO_PAGO_ACCESS_TOKEN", /MERCADO_PAGO_ACCESS_TOKEN is required/],
    ["MERCADO_PAGO_WEBHOOK_SECRET", /MERCADO_PAGO_WEBHOOK_SECRET is required/],
    ["MERCADO_PAGO_BACK_URL", /MERCADO_PAGO_BACK_URL is required/],
  ] as const;

  for (const [credential, expectedError] of missingCredentialCases) {
    const environment = smokeEnvironment();
    delete environment[credential];
    await assert.rejects(
      runMercadoPagoSandboxSmoke(environment, {
        createDatabase: () => { throw new Error("database must not be opened before credential validation"); },
        createPaymentProvider: () => { throw new Error("provider must not be created"); },
      }),
      expectedError,
    );
  }
});

test("sandbox RUN_ID is a stable source for idempotency and separates homologations", () => {
  assert.equal(sandboxSmokeIdempotencyKey("run-1"), sandboxSmokeIdempotencyKey(" run-1 "));
  assert.notEqual(sandboxSmokeIdempotencyKey("run-1"), sandboxSmokeIdempotencyKey("run-2"));
});

test("same sandbox RUN_ID reuses the local intention and a new RUN_ID creates another one", async () => {
  const subscriptions = new MemorySubscriptions();
  const transactions = new MemoryTransactions();
  let sequence = 0;
  let providerCalls = 0;
  const provider: PaymentProvider = {
    name: "mercadopago",
    createSubscriptionIntent: async () => { providerCalls += 1; return { status: PaymentTransactionStatus.PENDING, providerSubscriptionId: `pre-${providerCalls}`, checkoutUrl: `https://example.test/sub-${providerCalls}` }; },
    createSetupFeeIntent: async () => { providerCalls += 1; return { status: PaymentTransactionStatus.PENDING, providerPaymentId: `pref-${providerCalls}`, checkoutUrl: `https://example.test/setup-${providerCalls}` }; },
  };
  const service = new SubscriptionService({
    subscriptionRepository: subscriptions,
    paymentTransactionRepository: transactions,
    paymentProvider: provider,
    generateId: (prefix) => `${prefix}-${++sequence}`,
    generateIdempotencyKey: () => `generated-${++sequence}`,
    now: () => "2026-10-16T00:00:00.000Z",
  });
  const first = await service.start({ businessId: "sandbox-mp-business", plan: "INTERMEDIATE", billingCycle: "MONTHLY", payerEmail: "payer@example.test", idempotencyKey: sandboxSmokeIdempotencyKey("run-1") });
  const repeated = await service.start({ businessId: "sandbox-mp-business", plan: "BASIC", billingCycle: "ANNUAL", payerEmail: "payer@example.test", idempotencyKey: sandboxSmokeIdempotencyKey("run-1") });
  const newRun = await service.start({ businessId: "sandbox-mp-business", plan: "INTERMEDIATE", billingCycle: "MONTHLY", payerEmail: "payer@example.test", idempotencyKey: sandboxSmokeIdempotencyKey("run-2") });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.subscription.id, first.subscription.id);
  assert.equal(newRun.reused, false);
  assert.notEqual(newRun.subscription.id, first.subscription.id);
  assert.equal(providerCalls, 4);
});

test("sandbox output and errors never expose credentials or the full payer email", () => {
  const environment = smokeEnvironment({
    MERCADO_PAGO_ACCESS_TOKEN: "access-token-secret",
    MERCADO_PAGO_WEBHOOK_SECRET: "webhook-secret",
    POSTGRES_TEST_PASSWORD: "postgres-secret",
    MERCADO_PAGO_TEST_PAYER_EMAIL: "payer@example.test",
  });
  const output = formatSandboxSmokeReport({
    subscriptionId: "subscription-1", plan: "INTERMEDIATE", billingCycle: "MONTHLY",
    setupFeeCents: 89_000, subscriptionAmountCents: 69_700,
    providerSubscriptionId: "preapproval-1", providerSetupPaymentId: "preference-1",
    checkoutUrls: { subscription: "https://example.test/subscription", setup: "https://example.test/setup" },
    status: "PENDING", dryRun: false, reused: false,
  });
  assert.doesNotMatch(output, /access-token-secret|webhook-secret|postgres-secret|payer@example\.test/);
  const error = redactSandboxError(new Error("request failed access-token-secret payer@example.test"), environment);
  assert.doesNotMatch(error, /access-token-secret|payer@example\.test/);
  assert.match(error, /\[redacted\]/);
});

function smokeEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PAYMENT_MODE: "mercadopago",
    MERCADO_PAGO_ENVIRONMENT: "test",
    MERCADO_PAGO_ACCESS_TOKEN: "access-token-secret",
    MERCADO_PAGO_WEBHOOK_SECRET: "webhook-secret",
    MERCADO_PAGO_BACK_URL: "https://example.test/payment-return",
    MERCADO_PAGO_SANDBOX_CONFIRM: "YES",
    MERCADO_PAGO_TEST_PAYER_EMAIL: "payer@example.test",
    MERCADO_PAGO_SANDBOX_RUN_ID: "run-1",
    ...overrides,
  };
}

function fakeSandboxDatabase(): PostgresDatabase {
  const database = {
    query: async (text: string) => {
      if (text.includes("FROM automotive_businesses")) {
        return { rows: [{ id: "sandbox-mp-business", name: "Mercado Pago Sandbox", business_type: "WORKSHOP", timezone: "America/Sao_Paulo", active: true, created_at: "2026-10-16", updated_at: "2026-10-16" }] };
      }
      if (text.includes("FROM business_billing_profiles")) {
        return { rows: [{ business_id: "sandbox-mp-business", payer_email: "payer@example.test", created_at: "2026-10-16", updated_at: "2026-10-16" }] };
      }
      throw new Error(`Unexpected sandbox query: ${text}`);
    },
    transaction: async <T>(operation: (client: never) => Promise<T>) => operation(undefined as never),
    close: async () => undefined,
  } as unknown as PostgresDatabase;
  return database;
}

class MemorySubscriptions implements SubscriptionRepository {
  readonly items: Subscription[] = [];
  async save(value: Subscription): Promise<void> { const index = this.items.findIndex((item) => item.id === value.id); if (index < 0) this.items.push(value); else this.items[index] = value; }
  async findById(businessId: string, subscriptionId: string): Promise<Subscription | null> { return this.items.find((item) => item.businessId === businessId && item.id === subscriptionId) ?? null; }
  async findByBusinessAndIdempotencyKey(businessId: string, idempotencyKey: string): Promise<Subscription | null> { return this.items.find((item) => item.businessId === businessId && item.idempotencyKey === idempotencyKey) ?? null; }
  async findByProviderSubscriptionId(provider: string, providerSubscriptionId: string): Promise<Subscription | null> { return this.items.find((item) => item.provider === provider && item.providerSubscriptionId === providerSubscriptionId) ?? null; }
  async findByExternalReference(provider: string, externalReference: string): Promise<Subscription | null> { return this.items.find((item) => item.provider === provider && item.externalReference === externalReference) ?? null; }
}

class MemoryTransactions implements PaymentTransactionRepository {
  readonly items: PaymentTransaction[] = [];
  async save(value: PaymentTransaction): Promise<void> { const index = this.items.findIndex((item) => item.id === value.id); if (index < 0) this.items.push(value); else this.items[index] = value; }
  async findByBusinessAndIdempotencyKey(businessId: string, idempotencyKey: string): Promise<PaymentTransaction | null> { return this.items.find((item) => item.businessId === businessId && item.idempotencyKey === idempotencyKey) ?? null; }
  async findByProviderPaymentId(provider: string, providerPaymentId: string): Promise<PaymentTransaction | null> { return this.items.find((item) => item.provider === provider && item.providerPaymentId === providerPaymentId) ?? null; }
  async listBySubscription(businessId: string, subscriptionId: string): Promise<PaymentTransaction[]> { return this.items.filter((item) => item.businessId === businessId && item.subscriptionId === subscriptionId); }
}
