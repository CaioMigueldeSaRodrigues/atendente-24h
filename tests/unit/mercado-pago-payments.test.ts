import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { AdminPlan } from "../../src/core/admin-plan-entitlement.js";
import { BusinessBillingProfileService, type BusinessBillingProfile, type BusinessBillingProfileRepository } from "../../src/core/business-billing-profile.js";
import { BillingCycle, getPaymentCatalogEntry } from "../../src/core/payment-catalog.js";
import type { PaymentProvider } from "../../src/core/payment-provider.js";
import { PaymentTransactionStatus, type PaymentTransaction, type PaymentTransactionRepository } from "../../src/core/payment-transaction.js";
import { SubscriptionService } from "../../src/core/subscription-service.js";
import type { Subscription, SubscriptionRepository } from "../../src/core/subscription.js";
import { MercadoPagoPaymentProvider, MercadoPagoProviderError, type MercadoPagoHttpRequest } from "../../src/integrations/payment/mercado-pago-payment-provider.js";
import { createBasicPlanHttpServer } from "../../src/infrastructure/http/basic-plan-http-server.js";
import {
  InMemoryAppointmentRepository, InMemoryCommercialEventRepository, InMemoryConversationRepository,
  InMemoryCustomerRepository, InMemoryHumanHandoffRepository, InMemoryMessageRepository,
  InMemoryOpportunityRepository, InMemoryOutboundDeliveryRepository, InMemoryQuoteRequestRepository,
  InMemoryVehicleRepository,
} from "../../src/core/in-memory-repositories.js";

test("Mercado Pago builds monthly preapproval from the server catalog", async () => {
  const requests: MercadoPagoHttpRequest[] = [];
  const provider = new MercadoPagoPaymentProvider({
    accessToken: "token-not-logged",
    backUrl: "https://app.example.test/payment-return",
    httpClient: async (request) => {
      requests.push(request);
      return { status: 201, json: async () => ({ id: "preapproval-1", status: "pending", init_point: "https://mp.test/subscription-1", external_reference: "subscription:local-1" }) };
    },
  });
  const result = await provider.createSubscriptionIntent({
    businessId: "business-a", plan: AdminPlan.BASIC, billingCycle: BillingCycle.MONTHLY,
    catalog: getPaymentCatalogEntry(AdminPlan.BASIC, BillingCycle.MONTHLY), payerEmail: "payer@business-a.test",
    externalReference: "subscription:local-1", idempotencyKey: "local-1:subscription",
  });
  assert.equal(result.providerSubscriptionId, "preapproval-1");
  assert.equal(result.checkoutUrl, "https://mp.test/subscription-1");
  assert.equal(result.providerStatus, "pending");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.mercadopago.com/preapproval");
  assert.equal(requests[0]?.headers.Authorization, "Bearer token-not-logged");
  assert.equal(requests[0]?.headers["X-Idempotency-Key"], "local-1:subscription");
  assert.deepEqual(JSON.parse(requests[0]!.body!), {
    payer_email: "payer@business-a.test",
    reason: "Atendente 24h - BASIC MONTHLY",
    external_reference: "subscription:local-1",
    auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 397, currency_id: "BRL" },
    back_url: "https://app.example.test/payment-return",
  });
});

test("Mercado Pago builds annual preapproval at twelve-month frequency and keeps setup separate", async () => {
  const requests: MercadoPagoHttpRequest[] = [];
  const provider = new MercadoPagoPaymentProvider({
    accessToken: "token-not-logged", backUrl: "https://app.example.test/payment-return",
    httpClient: async (request) => {
      requests.push(request);
      return { status: 201, json: async () => request.url.endsWith("/preapproval")
        ? { id: "preapproval-annual", init_point: "https://mp.test/annual" }
        : { id: "preference-setup", init_point: "https://mp.test/setup", external_reference: "setup:local-1" } };
    },
  });
  const catalog = getPaymentCatalogEntry(AdminPlan.ADVANCED, BillingCycle.ANNUAL);
  const subscription = await provider.createSubscriptionIntent({
    businessId: "business-a", plan: AdminPlan.ADVANCED, billingCycle: BillingCycle.ANNUAL, catalog,
    payerEmail: "payer@business-a.test", externalReference: "subscription:local-1", idempotencyKey: "local-1:subscription",
  });
  const setup = await provider.createSetupFeeIntent({
    businessId: "business-a", catalog, payerEmail: "payer@business-a.test", externalReference: "setup:local-1", idempotencyKey: "local-1:setup",
  });
  const annualBody = JSON.parse(requests[0]!.body!) as Record<string, unknown>;
  const setupBody = JSON.parse(requests[1]!.body!) as Record<string, unknown>;
  assert.deepEqual(annualBody.auto_recurring, { frequency: 12, frequency_type: "months", transaction_amount: 11970, currency_id: "BRL" });
  assert.equal(setupBody.external_reference, "setup:local-1");
  assert.equal((setupBody.items as Array<Record<string, unknown>>)[0]?.unit_price, 1490);
  assert.equal(requests[0]?.headers["X-Idempotency-Key"], "local-1:subscription");
  assert.equal(requests[1]?.headers["X-Idempotency-Key"], "local-1:setup");
  assert.notEqual(requests[0]?.headers["X-Idempotency-Key"], requests[1]?.headers["X-Idempotency-Key"]);
  assert.equal(subscription.checkoutUrl, "https://mp.test/annual");
  assert.equal(setup.checkoutUrl, "https://mp.test/setup");
});

test("Mercado Pago errors are sanitized and retryable calls reuse the same key", async () => {
  const provider = new MercadoPagoPaymentProvider({
    accessToken: "secret-token", backUrl: "https://app.example.test/payment-return",
    httpClient: async () => ({ status: 400, json: async () => ({ access_token: "must-not-escape", message: "sensitive" }) }),
  });
  await assert.rejects(
    provider.createSubscriptionIntent({
      businessId: "business-a", plan: AdminPlan.BASIC, billingCycle: BillingCycle.MONTHLY,
      catalog: getPaymentCatalogEntry(AdminPlan.BASIC, BillingCycle.MONTHLY), payerEmail: "payer@business-a.test",
      externalReference: "subscription:local-1", idempotencyKey: "local-1:subscription",
    }),
    (error: unknown) => error instanceof MercadoPagoProviderError
      && error.message === "Mercado Pago request failed with HTTP 400"
      && error.transient === false
      && !error.message.includes("secret-token"),
  );

  const subscriptions = new MemorySubscriptions();
  const transactions = new MemoryTransactions();
  const calls: Array<{ type: string; key: string }> = [];
  let failSetup = true;
  const retryProvider: PaymentProvider = {
    name: "mercadopago",
    createSubscriptionIntent: async (input) => { calls.push({ type: "subscription", key: input.idempotencyKey }); return { status: PaymentTransactionStatus.PENDING, providerSubscriptionId: "sub-1", checkoutUrl: "https://mp.test/sub" }; },
    createSetupFeeIntent: async (input) => {
      calls.push({ type: "setup", key: input.idempotencyKey });
      if (failSetup) { failSetup = false; throw new Error("temporary provider error"); }
      return { status: PaymentTransactionStatus.PENDING, providerPaymentId: "pref-1", checkoutUrl: "https://mp.test/setup" };
    },
  };
  const service = createService(subscriptions, transactions, retryProvider);
  await assert.rejects(service.start({ businessId: "business-a", plan: "BASIC", billingCycle: "MONTHLY", payerEmail: "payer@business-a.test", idempotencyKey: "request-1" }));
  const retry = await service.start({ businessId: "business-a", plan: "ADVANCED", billingCycle: "ANNUAL", payerEmail: "payer@business-a.test", idempotencyKey: "request-1" });
  assert.equal(retry.reused, true);
  assert.deepEqual(calls, [
    { type: "subscription", key: `${retry.subscription.id}:subscription` },
    { type: "setup", key: `${retry.subscription.id}:setup` },
    { type: "setup", key: `${retry.subscription.id}:setup` },
  ]);
  assert.equal(retry.subscription.subscriptionAmountCents, 39700);
});

test("Mercado Pago read API uses authenticated GET resources and maps provider data", async () => {
  const requests: MercadoPagoHttpRequest[] = [];
  const provider = new MercadoPagoPaymentProvider({
    accessToken: "token-not-logged", backUrl: "https://app.example.test/payment-return",
    httpClient: async (request) => {
      requests.push(request);
      if (request.url.endsWith("/preapproval/pre-1")) return { status: 200, json: async () => ({ id: "pre-1", status: "authorized", external_reference: "subscription:local-1", auto_recurring: { transaction_amount: 397, currency_id: "BRL", frequency: 1, frequency_type: "months" } }) };
      if (request.url.endsWith("/authorized_payments/auth-1")) return { status: 200, json: async () => ({ id: "auth-1", preapproval_id: "pre-1", payment: { id: "payment-1" } }) };
      return { status: 200, json: async () => ({ id: "payment-1", status: "approved", status_detail: "accredited", external_reference: "subscription:local-1", transaction_amount: 397, currency_id: "BRL" }) };
    },
  });
  const subscription = await provider.getSubscription("pre-1");
  const authorized = await provider.getAuthorizedPayment("auth-1");
  const payment = await provider.getPayment("payment-1");
  assert.deepEqual(subscription.autoRecurring, { transactionAmountCents: 39700, currencyId: "BRL", frequency: 1, frequencyType: "months" });
  assert.equal(authorized.preapprovalId, "pre-1");
  assert.equal(authorized.paymentId, "payment-1");
  assert.equal(payment.transactionAmountCents, 39700);
  assert.deepEqual(requests.map((request) => [request.method, request.url, request.headers.Authorization]), [
    ["GET", "https://api.mercadopago.com/preapproval/pre-1", "Bearer token-not-logged"],
    ["GET", "https://api.mercadopago.com/authorized_payments/auth-1", "Bearer token-not-logged"],
    ["GET", "https://api.mercadopago.com/v1/payments/payment-1", "Bearer token-not-logged"],
  ]);
});

test("subscription checkout endpoint rejects monetary fields and isolates the authorized tenant", async () => {
  const subscriptions = new MemorySubscriptions();
  const transactions = new MemoryTransactions();
  const billingProfiles = new MemoryBillingProfiles();
  const billingProfileService = new BusinessBillingProfileService(billingProfiles);
  await billingProfileService.save({ businessId: "business-a", payerEmail: "Billing-A@Example.Test", now: "2026-10-15T12:00:00.000Z" });
  await billingProfileService.save({ businessId: "business-b", payerEmail: "billing-b@example.test", now: "2026-10-15T12:00:00.000Z" });
  const payerEmails: string[] = [];
  const paymentProvider: PaymentProvider = {
    name: "mock",
    createSubscriptionIntent: async (input) => { payerEmails.push(input.payerEmail); return { status: PaymentTransactionStatus.PENDING, providerSubscriptionId: "mock-subscription", checkoutUrl: "https://mock.local/subscription" }; },
    createSetupFeeIntent: async (input) => { payerEmails.push(input.payerEmail); return { status: PaymentTransactionStatus.PENDING, providerPaymentId: "mock-setup", checkoutUrl: "https://mock.local/setup" }; },
  };
  const service = createService(subscriptions, transactions, paymentProvider);
  const server = createBasicPlanHttpServer({
    conversationRepository: new InMemoryConversationRepository(), messageRepository: new InMemoryMessageRepository(),
    customerRepository: new InMemoryCustomerRepository(), vehicleRepository: new InMemoryVehicleRepository(),
    opportunityRepository: new InMemoryOpportunityRepository(), quoteRequestRepository: new InMemoryQuoteRequestRepository(),
    outboundDeliveryRepository: new InMemoryOutboundDeliveryRepository(), appointmentRepository: new InMemoryAppointmentRepository(),
    humanHandoffRepository: new InMemoryHumanHandoffRepository(), commercialEventRepository: new InMemoryCommercialEventRepository(),
    evolutionGoWebhookTransaction: { run: async <T>(operation: () => Promise<T>) => operation() },
    businessOperatorAuthorizer: { isAuthorized: async ({ businessId }) => businessId === "business-a" },
    operator: { businessId: "business-a", businessName: "Oficina A" }, interpreter: { interpret: async () => { throw new Error("not used"); } },
    subscriptionService: service, paymentPayerEmailResolver: async (businessId) => billingProfileService.resolvePayerEmail(businessId),
    now: () => "2026-10-15T12:00:00.000Z", generateId: (prefix) => `${prefix}-http`,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/v1/businesses/business-a/subscriptions/checkout`;
  try {
    const tampered = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: "BASIC", billingCycle: "MONTHLY", amount: 1 }) });
    assert.equal(tampered.status, 400);
    assert.equal(subscriptions.items.length, 0);
    billingProfiles.items.length = 0;
    const missingProfile = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: "BASIC", billingCycle: "MONTHLY" }) });
    assert.equal(missingProfile.status, 503);
    assert.deepEqual(await missingProfile.json(), { error: "Payment payer identity is not configured" });
    await billingProfileService.save({ businessId: "business-a", payerEmail: "Billing-A@Example.Test", now: "2026-10-15T12:00:00.000Z" });
    const payerEmailInBody = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: "BASIC", billingCycle: "MONTHLY", payerEmail: "attacker@example.test" }) });
    assert.equal(payerEmailInBody.status, 400);
    const unauthorized = await fetch(url.replace("business-a", "business-b"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: "BASIC", billingCycle: "MONTHLY" }) });
    assert.equal(unauthorized.status, 404);
    const valid = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "http-request-1" }, body: JSON.stringify({ plan: "INTERMEDIATE", billingCycle: "ANNUAL" }) });
    assert.equal(valid.status, 201);
    const body = await valid.json() as { subscriptionId: string; status: string; checkoutUrls: { setup?: string; subscription?: string } };
    assert.equal(body.status, "PENDING");
    assert.match(body.checkoutUrls.subscription ?? "", /^https:\/\/mock\.local\//);
    assert.match(body.checkoutUrls.setup ?? "", /^https:\/\/mock\.local\//);
    assert.equal(subscriptions.items[0]?.subscriptionAmountCents, 697000);
    assert.equal(subscriptions.items[0]?.status, "PENDING");
    assert.deepEqual(payerEmails, ["billing-a@example.test", "billing-a@example.test"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function createService(subscriptions: MemorySubscriptions, transactions: MemoryTransactions, paymentProvider: PaymentProvider): SubscriptionService {
  let sequence = 0;
  return new SubscriptionService({
    subscriptionRepository: subscriptions, paymentTransactionRepository: transactions, paymentProvider,
    generateId: (prefix) => `${prefix}-${++sequence}`, generateIdempotencyKey: () => `generated-${++sequence}`,
    now: () => "2026-10-15T12:00:00.000Z",
  });
}

test("billing profile resolves only the persisted tenant email and rejects invalid contacts", async () => {
  const profiles = new MemoryBillingProfiles();
  const service = new BusinessBillingProfileService(profiles);
  await service.save({ businessId: "business-a", payerEmail: " Billing-A@Example.Test ", now: "2026-10-15T12:00:00.000Z" });
  await service.save({ businessId: "business-b", payerEmail: "billing-b@example.test", now: "2026-10-15T12:00:00.000Z" });
  assert.equal(await service.resolvePayerEmail("business-a"), "billing-a@example.test");
  assert.equal(await service.resolvePayerEmail("business-b"), "billing-b@example.test");
  assert.equal(await service.resolvePayerEmail("business-c"), null);
  await assert.rejects(service.save({ businessId: "business-c", payerEmail: "not-an-email", now: "2026-10-15T12:00:00.000Z" }), /payerEmail is invalid/);
});

class MemorySubscriptions implements SubscriptionRepository {
  readonly items: Subscription[] = [];
  async save(value: Subscription): Promise<void> { const index = this.items.findIndex((item) => item.id === value.id); if (index < 0) this.items.push(value); else this.items[index] = value; }
  async findById(businessId: string, subscriptionId: string): Promise<Subscription | null> { return this.items.find((item) => item.businessId === businessId && item.id === subscriptionId) ?? null; }
  async findByBusinessAndIdempotencyKey(businessId: string, key: string): Promise<Subscription | null> { return this.items.find((item) => item.businessId === businessId && item.idempotencyKey === key) ?? null; }
  async findByProviderSubscriptionId(provider: string, providerSubscriptionId: string): Promise<Subscription | null> { return this.items.find((item) => item.provider === provider && item.providerSubscriptionId === providerSubscriptionId) ?? null; }
  async findByExternalReference(provider: string, externalReference: string): Promise<Subscription | null> { return this.items.find((item) => item.provider === provider && item.externalReference === externalReference) ?? null; }
}

class MemoryTransactions implements PaymentTransactionRepository {
  readonly items: PaymentTransaction[] = [];
  async save(value: PaymentTransaction): Promise<void> { const index = this.items.findIndex((item) => item.id === value.id); if (index < 0) this.items.push(value); else this.items[index] = value; }
  async findByBusinessAndIdempotencyKey(businessId: string, key: string): Promise<PaymentTransaction | null> { return this.items.find((item) => item.businessId === businessId && item.idempotencyKey === key) ?? null; }
  async findByProviderPaymentId(provider: string, providerPaymentId: string): Promise<PaymentTransaction | null> { return this.items.find((item) => item.provider === provider && item.providerPaymentId === providerPaymentId) ?? null; }
  async listBySubscription(businessId: string, subscriptionId: string): Promise<PaymentTransaction[]> { return this.items.filter((item) => item.businessId === businessId && item.subscriptionId === subscriptionId); }
}

class MemoryBillingProfiles implements BusinessBillingProfileRepository {
  readonly items: BusinessBillingProfile[] = [];
  async findByBusinessId(businessId: string): Promise<BusinessBillingProfile | null> { return this.items.find((item) => item.businessId === businessId) ?? null; }
  async save(value: BusinessBillingProfile): Promise<void> { const index = this.items.findIndex((item) => item.businessId === value.businessId); if (index < 0) this.items.push(value); else this.items[index] = value; }
}
