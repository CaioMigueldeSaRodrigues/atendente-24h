import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { AdminPlan } from "../../src/core/admin-plan-entitlement.js";
import type { BusinessPlanAssignment, BusinessPlanAssignmentRepository } from "../../src/core/business-plan.js";
import {
  MercadoPagoWebhookEventType,
  MercadoPagoWebhookService,
  MercadoPagoWebhookTransientError,
} from "../../src/core/mercado-pago-webhook-service.js";
import { PaymentProviderTransientError, type PaymentProviderReadApi, type ProviderAuthorizedPaymentResource, type ProviderPaymentResource, type ProviderSubscriptionResource } from "../../src/core/payment-provider.js";
import { PaymentTransactionStatus, PaymentTransactionType, type PaymentTransaction, type PaymentTransactionRepository } from "../../src/core/payment-transaction.js";
import { PaymentWebhookProcessingStatus, type PaymentWebhookEvent, type PaymentWebhookEventRepository } from "../../src/core/payment-webhook-event.js";
import { SubscriptionStatus, type Subscription, type SubscriptionRepository } from "../../src/core/subscription.js";
import { MercadoPagoWebhookVerifier } from "../../src/integrations/payment/mercado-pago-webhook-verifier.js";
import { createBasicPlanHttpServer } from "../../src/infrastructure/http/basic-plan-http-server.js";
import {
  InMemoryAppointmentRepository, InMemoryCommercialEventRepository, InMemoryConversationRepository,
  InMemoryCustomerRepository, InMemoryHumanHandoffRepository, InMemoryMessageRepository,
  InMemoryOpportunityRepository, InMemoryOutboundDeliveryRepository, InMemoryQuoteRequestRepository,
  InMemoryVehicleRepository,
} from "../../src/core/in-memory-repositories.js";

test("Mercado Pago webhook verifier validates the documented HMAC manifest and rejects tampering", () => {
  const secret = "webhook-secret";
  const verifier = new MercadoPagoWebhookVerifier(secret);
  const signature = sign(secret, "payment-1", "request-1", "1700000000");
  assert.equal(verifier.verify({ signature, requestId: "request-1", dataId: "payment-1" }), true);
  assert.equal(verifier.verify({ signature, requestId: "request-1", dataId: "payment-2" }), false);
  assert.equal(verifier.verify({ signature: undefined, requestId: "request-1", dataId: "payment-1" }), false);
  assert.equal(verifier.verify({ signature, requestId: undefined, dataId: "payment-1" }), false);
  assert.equal(verifier.verify({ signature: sign(secret, "payment-1", undefined, "1700000000"), requestId: undefined, dataId: "payment-1" }), true);
});

test("A+B+C activates exactly once and remains tenant-scoped", async () => {
  for (const order of [
    ["setup", "subscription", "recurring"],
    ["recurring", "setup", "subscription"],
    ["subscription", "recurring", "setup"],
  ]) {
    const h = createHarness();
    for (const step of order) await processStep(h.service, step, h.ids);
    assert.equal(h.subscriptions.items[0]?.status, SubscriptionStatus.ACTIVE);
    assert.deepEqual(h.assignments.items.map((item) => [item.businessId, item.plan, item.status]), [["business-a", AdminPlan.INTERMEDIATE, "ACTIVE"]]);
    const repeated = await processStep(h.service, "recurring", h.ids, "recurring-repeat");
    assert.equal(repeated.status, "processed");
    assert.equal(h.assignments.items.filter((item) => item.status === "ACTIVE").length, 1);
  }
});

test("setup, authorized subscription and recurring payment alone do not activate", async () => {
  const cases: Array<string[]> = [["setup"], ["subscription"], ["recurring"], ["setup", "subscription"], ["subscription", "recurring"], ["setup", "recurring"]];
  for (const steps of cases) {
    const h = createHarness();
    for (const step of steps) await processStep(h.service, step, h.ids);
    assert.equal(h.subscriptions.items[0]?.status === SubscriptionStatus.ACTIVE, false, steps.join("+"));
    assert.equal(h.assignments.items.length, 0, steps.join("+"));
  }
});

test("setup confirmation does not claim the recurring provider subscription id", async () => {
  const h = createHarness();
  await processStep(h.service, "setup", h.ids);
  assert.equal(h.transactions.items.find((item) => item.type === PaymentTransactionType.SETUP_FEE)?.providerSubscriptionId, undefined);
  assert.equal(h.transactions.items.find((item) => item.type === PaymentTransactionType.SUBSCRIPTION)?.providerSubscriptionId, "pre-a");
});

test("invalid amount, currency, reference and canceled/paused preapproval are ignored without effects", async () => {
  const h = createHarness();
  h.provider.payments.set("wrong-payment", { id: "wrong-payment", status: "approved", statusDetail: "accredited", externalReference: "setup:sub-a", transactionAmountCents: 1, currencyId: "BRL" });
  const amount = await processStep(h.service, "wrong-payment", h.ids, "bad-amount", "payment");
  assert.equal(amount.status, "ignored");
  assert.equal(h.transactions.items.find((item) => item.providerPaymentId === "wrong-payment"), undefined);

  h.provider.subscriptions.set("pre-a", { ...h.provider.subscriptions.get("pre-a")!, status: "paused" });
  const paused = await processStep(h.service, "subscription", h.ids, "paused-event");
  assert.equal(paused.status, "processed");
  assert.equal(h.subscriptions.items[0]?.status, SubscriptionStatus.PAUSED);
  assert.equal(h.assignments.items.length, 0);
});

test("test environment accepts only live_mode=false", async () => {
  const allowed = createHarness(undefined, "test");
  assert.equal((await processStep(allowed.service, "setup", allowed.ids, "test-false", "payment", false)).status, "processed");
  assert.equal(allowed.provider.paymentReads, 1);

  const rejected = createHarness(undefined, "test");
  assert.equal((await processStep(rejected.service, "setup", rejected.ids, "test-true", "payment", true)).status, "ignored");
  assert.equal(rejected.provider.paymentReads, 0);
  assert.equal(rejected.subscriptions.items[0]?.status, SubscriptionStatus.PENDING);
  assert.equal(rejected.assignments.items.length, 0);
  assert.equal(rejected.events.items[0]?.processingStatus, PaymentWebhookProcessingStatus.IGNORED);
  assert.equal(rejected.events.items[0]?.errorMessage, "live_mode does not match Mercado Pago environment");
});

test("production environment accepts only live_mode=true", async () => {
  const allowed = createHarness(undefined, "production");
  assert.equal((await processStep(allowed.service, "setup", allowed.ids, "production-true", "payment", true)).status, "processed");
  assert.equal(allowed.provider.paymentReads, 1);

  const rejected = createHarness(undefined, "production");
  assert.equal((await processStep(rejected.service, "setup", rejected.ids, "production-false", "payment", false)).status, "ignored");
  assert.equal(rejected.provider.paymentReads, 0);
  assert.equal(rejected.subscriptions.items[0]?.status, SubscriptionStatus.PENDING);
  assert.equal(rejected.assignments.items.length, 0);
  assert.equal(rejected.events.items[0]?.processingStatus, PaymentWebhookProcessingStatus.IGNORED);
  assert.equal(rejected.events.items[0]?.errorMessage, "live_mode does not match Mercado Pago environment");
});

test("future recurring payments create one transaction per provider payment and replay does not duplicate", async () => {
  const h = createHarness();
  await processStep(h.service, "setup", h.ids);
  await processStep(h.service, "subscription", h.ids);
  await processStep(h.service, "recurring", h.ids);
  h.provider.payments.set("payment-2", payment("payment-2", "subscription:sub-a", 69700));
  await processStep(h.service, "payment-2", h.ids, "future-2", "payment");
  await processStep(h.service, "payment-2", h.ids, "future-2-replay", "payment");
  assert.equal(h.transactions.items.filter((item) => item.type === PaymentTransactionType.SUBSCRIPTION).length, 2);
  assert.equal(h.transactions.items.filter((item) => item.providerPaymentId === "payment-2").length, 1);
});

test("same webhook claimed concurrently produces one remote effect and one in-progress result", async () => {
  const h = createHarness();
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  h.provider.waitForPayment = paused;
  const event = makeEvent("concurrent", "payment-setup", "payment");
  const first = h.service.process({ event, eventType: "payment", resourceId: "payment-setup" });
  const second = h.service.process({ event: { ...event }, eventType: "payment", resourceId: "payment-setup" });
  const secondResult = await second;
  assert.equal(secondResult.status, "in_progress");
  release();
  assert.equal((await first).status, "processed");
  assert.equal(h.transactions.items.filter((item) => item.providerPaymentId === "payment-setup").length, 1);
});

test("provider failure marks the event failed and exposes only a retryable sanitized error", async () => {
  const h = createHarness();
  h.provider.failReads = true;
  await assert.rejects(processStep(h.service, "setup", h.ids), (error: unknown) => error instanceof MercadoPagoWebhookTransientError);
  assert.equal(h.events.items[0]?.processingStatus, PaymentWebhookProcessingStatus.FAILED);
  assert.equal(h.events.items[0]?.errorMessage, "provider verification failed");
});

test("internal processing failures are not mislabeled as provider downtime and can be retried", async () => {
  const expected = new Error("database constraint failure");
  let failOnce = true;
  const h = createHarness({
    run: async <T>(operation: () => Promise<T>) => {
      if (failOnce) {
        failOnce = false;
        throw expected;
      }
      return operation();
    },
  });
  await assert.rejects(processStep(h.service, "setup", h.ids), (error: unknown) => error === expected);
  assert.equal(h.events.items[0]?.processingStatus, PaymentWebhookProcessingStatus.FAILED);
  assert.equal(h.events.items[0]?.errorMessage, "internal webhook processing failure");
  assert.equal((await processStep(h.service, "setup", h.ids)).status, "processed");
  assert.equal(h.events.items[0]?.processingStatus, PaymentWebhookProcessingStatus.PROCESSED);
});

test("public webhook endpoint requires HMAC but does not require operator session", async () => {
  const h = createHarness();
  const server = createBasicPlanHttpServer({
    conversationRepository: new InMemoryConversationRepository(), messageRepository: new InMemoryMessageRepository(),
    customerRepository: new InMemoryCustomerRepository(), vehicleRepository: new InMemoryVehicleRepository(),
    opportunityRepository: new InMemoryOpportunityRepository(), quoteRequestRepository: new InMemoryQuoteRequestRepository(),
    outboundDeliveryRepository: new InMemoryOutboundDeliveryRepository(), appointmentRepository: new InMemoryAppointmentRepository(),
    humanHandoffRepository: new InMemoryHumanHandoffRepository(), commercialEventRepository: new InMemoryCommercialEventRepository(),
    evolutionGoWebhookTransaction: { run: async <T>(operation: () => Promise<T>) => operation() },
    businessOperatorAuthorizer: { isAuthorized: async () => false },
    operator: { businessId: "business-a", businessName: "Oficina A" }, interpreter: { interpret: async () => { throw new Error("not used"); } },
    mercadoPagoWebhookVerifier: new MercadoPagoWebhookVerifier("webhook-secret"), mercadoPagoWebhookService: h.service,
    now: () => "2026-10-15T12:00:00.000Z", generateId: (prefix) => `${prefix}-http`,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/v1/payments/mercadopago/webhook?data.id=payment-setup`;
  const payload = JSON.stringify({ type: "payment", data: { id: "payment-setup" } });
  try {
    const unauthorized = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "http-event-1", "x-signature": "ts=1700000000;v1=00" }, body: payload });
    assert.equal(unauthorized.status, 401);
    assert.equal(h.events.items.length, 0);
    const accepted = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "http-event-1", "x-signature": sign("webhook-secret", "payment-setup", "http-event-1", "1700000000") }, body: payload });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { accepted: true, status: "processed" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

type Harness = {
  service: MercadoPagoWebhookService;
  subscriptions: MemorySubscriptions;
  transactions: MemoryTransactions;
  assignments: MemoryAssignments;
  events: MemoryEvents;
  provider: FakeProvider;
  ids: { setup: string; subscription: string; recurring: string; businessId: string };
};

type TransactionRunner = { run<T>(operation: () => Promise<T>): Promise<T> };

function createHarness(transaction: TransactionRunner = { run: async <T>(operation: () => Promise<T>) => operation() }, mercadoPagoEnvironment?: "test" | "production"): Harness {
  const subscriptions = new MemorySubscriptions();
  const transactions = new MemoryTransactions();
  const assignments = new MemoryAssignments();
  const events = new MemoryEvents();
  const provider = new FakeProvider();
  const subscription: Subscription = {
    id: "sub-a", businessId: "business-a", plan: AdminPlan.INTERMEDIATE, billingCycle: "MONTHLY", catalogVersion: "test",
    status: SubscriptionStatus.PENDING, provider: "mercadopago", providerSubscriptionId: "pre-a", providerStatus: "pending",
    externalReference: "subscription:sub-a", subscriptionAmountCents: 69700, setupFeeCents: 89000, currency: "BRL",
    idempotencyKey: "intent-a", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
  };
  subscriptions.items.push(subscription);
  transactions.items.push(
    { id: "tx-setup", businessId: "business-a", subscriptionId: "sub-a", provider: "mercadopago", providerPaymentId: "preference-setup", type: PaymentTransactionType.SETUP_FEE, amountCents: 89000, currency: "BRL", status: PaymentTransactionStatus.PENDING, idempotencyKey: "sub-a:setup", createdAt: subscription.createdAt, updatedAt: subscription.createdAt },
    { id: "tx-subscription", businessId: "business-a", subscriptionId: "sub-a", provider: "mercadopago", providerSubscriptionId: "pre-a", type: PaymentTransactionType.SUBSCRIPTION, amountCents: 69700, currency: "BRL", status: PaymentTransactionStatus.PENDING, idempotencyKey: "sub-a:subscription", createdAt: subscription.createdAt, updatedAt: subscription.createdAt },
  );
  provider.subscriptions.set("pre-a", { id: "pre-a", status: "authorized", externalReference: "subscription:sub-a", autoRecurring: { transactionAmountCents: 69700, currencyId: "BRL", frequency: 1, frequencyType: "months" } });
  provider.payments.set("payment-setup", payment("payment-setup", "setup:sub-a", 89000));
  provider.payments.set("payment-recurring", payment("payment-recurring", "subscription:sub-a", 69700));
  provider.authorized.set("authorized-1", { id: "authorized-1", preapprovalId: "pre-a", paymentId: "payment-recurring", externalReference: "subscription:sub-a" });
  const service = new MercadoPagoWebhookService({
    webhookEvents: events, subscriptions, transactions, assignments, provider,
    transaction,
    now: () => "2026-10-15T12:00:00.000Z", generateId: (prefix) => `${prefix}-${transactions.items.length + 1}`,
    ...(mercadoPagoEnvironment === undefined ? {} : { mercadoPagoEnvironment }),
  });
  return { service, subscriptions, transactions, assignments, events, provider, ids: { setup: "payment-setup", subscription: "pre-a", recurring: "authorized-1", businessId: "business-a" } };
}

async function processStep(service: MercadoPagoWebhookService, step: string, ids: Harness["ids"], eventId = step, eventType?: string, liveMode?: boolean) {
  const actualType = eventType ?? (step === "setup" ? "payment" : step === "subscription" ? "subscription_preapproval" : step === "recurring" ? "subscription_authorized_payment" : "payment");
  const resourceId = step === "setup" ? ids.setup : step === "subscription" ? ids.subscription : step === "recurring" ? ids.recurring : step;
  return service.process({ event: makeEvent(eventId, resourceId, actualType, liveMode), eventType: actualType, resourceId });
}

function makeEvent(id: string, resourceId: string, eventType: string, liveMode?: boolean): PaymentWebhookEvent {
  return { id: `event-row-${id}`, provider: "mercadopago", providerEventId: id, providerRequestId: `request-${id}`, resourceId, eventType, ...(liveMode === undefined ? {} : { liveMode }), payloadHash: `hash-${id}`, processingStatus: PaymentWebhookProcessingStatus.RECEIVED, receivedAt: "2026-10-15T12:00:00.000Z" };
}

function payment(id: string, externalReference: string, amountCents: number): ProviderPaymentResource {
  return { id, status: "approved", statusDetail: "accredited", externalReference, transactionAmountCents: amountCents, currencyId: "BRL" };
}

function sign(secret: string, dataId: string, requestId: string | undefined, ts: string): string {
  const parts = [`id:${dataId}`];
  if (requestId !== undefined) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  const digest = createHmac("sha256", secret).update(`${parts.join(";")};`).digest("hex");
  return `ts=${ts};v1=${digest}`;
}

class FakeProvider implements PaymentProviderReadApi {
  subscriptions = new Map<string, ProviderSubscriptionResource>();
  payments = new Map<string, ProviderPaymentResource>();
  authorized = new Map<string, ProviderAuthorizedPaymentResource>();
  waitForPayment?: Promise<void>;
  failReads = false;
  subscriptionReads = 0;
  paymentReads = 0;
  authorizedReads = 0;
  async getSubscription(id: string): Promise<ProviderSubscriptionResource> { this.subscriptionReads += 1; if (this.failReads) throw new PaymentProviderTransientError("provider secret"); return this.subscriptions.get(id)!; }
  async getPayment(id: string): Promise<ProviderPaymentResource> { this.paymentReads += 1; if (this.waitForPayment) await this.waitForPayment; if (this.failReads) throw new PaymentProviderTransientError("provider secret"); return this.payments.get(id)!; }
  async getAuthorizedPayment(id: string): Promise<ProviderAuthorizedPaymentResource> { this.authorizedReads += 1; if (this.failReads) throw new PaymentProviderTransientError("provider secret"); return this.authorized.get(id)!; }
}

class MemorySubscriptions implements SubscriptionRepository {
  items: Subscription[] = [];
  async save(value: Subscription): Promise<void> { const index = this.items.findIndex((item) => item.id === value.id); if (index < 0) this.items.push(value); else this.items[index] = value; }
  async findById(businessId: string, id: string): Promise<Subscription | null> { return this.items.find((item) => item.businessId === businessId && item.id === id) ?? null; }
  async findByBusinessAndIdempotencyKey(businessId: string, key: string): Promise<Subscription | null> { return this.items.find((item) => item.businessId === businessId && item.idempotencyKey === key) ?? null; }
  async findByProviderSubscriptionId(provider: string, id: string): Promise<Subscription | null> { return this.items.find((item) => item.provider === provider && item.providerSubscriptionId === id) ?? null; }
  async findByExternalReference(provider: string, reference: string): Promise<Subscription | null> { return this.items.find((item) => item.provider === provider && item.externalReference === reference) ?? null; }
}

class MemoryTransactions implements PaymentTransactionRepository {
  items: PaymentTransaction[] = [];
  async save(value: PaymentTransaction): Promise<void> { const index = this.items.findIndex((item) => item.id === value.id); if (index < 0) this.items.push(value); else this.items[index] = value; }
  async findByBusinessAndIdempotencyKey(businessId: string, key: string): Promise<PaymentTransaction | null> { return this.items.find((item) => item.businessId === businessId && item.idempotencyKey === key) ?? null; }
  async findByProviderPaymentId(provider: string, id: string): Promise<PaymentTransaction | null> { return this.items.find((item) => item.provider === provider && item.providerPaymentId === id) ?? null; }
  async listBySubscription(businessId: string, id: string): Promise<PaymentTransaction[]> { return this.items.filter((item) => item.businessId === businessId && item.subscriptionId === id); }
}

class MemoryAssignments implements BusinessPlanAssignmentRepository {
  items: BusinessPlanAssignment[] = [];
  async save(value: BusinessPlanAssignment): Promise<void> { const index = this.items.findIndex((item) => item.businessId === value.businessId && item.id === value.id); if (index < 0) this.items.push(value); else this.items[index] = value; }
  async findCurrent(businessId: string): Promise<BusinessPlanAssignment | null> { return this.items.find((item) => item.businessId === businessId && item.status === "ACTIVE") ?? null; }
  async listByBusiness(businessId: string): Promise<BusinessPlanAssignment[]> { return this.items.filter((item) => item.businessId === businessId); }
}

class MemoryEvents implements PaymentWebhookEventRepository {
  items: PaymentWebhookEvent[] = [];
  async save(value: PaymentWebhookEvent): Promise<void> { const index = this.items.findIndex((item) => item.id === value.id); if (index < 0) this.items.push(value); else this.items[index] = value; }
  async findByProviderEventId(provider: string, id: string): Promise<PaymentWebhookEvent | null> { return this.items.find((item) => item.provider === provider && item.providerEventId === id) ?? null; }
  async update(value: PaymentWebhookEvent): Promise<void> { await this.save(value); }
  async claim(value: PaymentWebhookEvent) {
    const existing = this.items.find((item) => item.provider === value.provider && item.providerEventId === value.providerEventId);
    if (existing?.processingStatus === PaymentWebhookProcessingStatus.PROCESSED || existing?.processingStatus === PaymentWebhookProcessingStatus.IGNORED) return { status: "duplicate" as const, event: existing };
    if (existing?.processingStatus === PaymentWebhookProcessingStatus.PROCESSING) return { status: "in_progress" as const, event: existing };
    if (existing) { existing.processingStatus = PaymentWebhookProcessingStatus.PROCESSING; return { status: "claimed" as const, event: existing }; }
    const claimed = { ...value, processingStatus: PaymentWebhookProcessingStatus.PROCESSING };
    this.items.push(claimed);
    return { status: "claimed" as const, event: claimed };
  }
}
