import { getPaymentCatalogEntry } from "./payment-catalog.js";
import type { PaymentProvider, ProviderIntentResult } from "./payment-provider.js";
import { PaymentTransactionStatus, PaymentTransactionType, type PaymentTransaction, type PaymentTransactionRepository } from "./payment-transaction.js";
import { SubscriptionStatus, type Subscription, type SubscriptionRepository } from "./subscription.js";

export type StartSubscriptionInput = {
  businessId: string;
  plan: string;
  billingCycle: string;
  payerEmail: string;
  idempotencyKey?: string;
};

export type StartSubscriptionResult = {
  subscription: Subscription;
  transactions: PaymentTransaction[];
  checkoutUrls: { subscription?: string; setup?: string };
  reused: boolean;
};

export type SubscriptionServiceDependencies = {
  subscriptionRepository: SubscriptionRepository;
  paymentTransactionRepository: PaymentTransactionRepository;
  paymentProvider: PaymentProvider;
  generateId: (prefix: string) => string;
  generateIdempotencyKey: () => string;
  now: () => string;
};

export class SubscriptionService {
  constructor(private readonly dependencies: SubscriptionServiceDependencies) {}

  async start(input: StartSubscriptionInput): Promise<StartSubscriptionResult> {
    if (!input.businessId.trim()) throw new Error("businessId is required");
    const payerEmail = normalizePayerEmail(input.payerEmail);
    const catalog = getPaymentCatalogEntry(input.plan, input.billingCycle);
    const requestIdempotencyKey = normalizeIdempotencyKey(input.idempotencyKey) ?? this.dependencies.generateIdempotencyKey();
    const existing = await this.dependencies.subscriptionRepository.findByBusinessAndIdempotencyKey(input.businessId, requestIdempotencyKey);
    if (existing !== null) {
      const transactions = await this.dependencies.paymentTransactionRepository.listBySubscription(input.businessId, existing.id);
      const existingCatalog = getPaymentCatalogEntry(existing.plan, existing.billingCycle);
      return this.completeProviderIntents(existing, transactions, existingCatalog, payerEmail, true);
    }

    const now = this.dependencies.now();
    const subscriptionId = this.dependencies.generateId("subscription");
    const externalReference = `subscription:${subscriptionId}`;
    const setupIdempotencyKey = `${subscriptionId}:setup`;
    const subscriptionIdempotencyKey = `${subscriptionId}:subscription`;
    const subscription: Subscription = {
      id: subscriptionId,
      businessId: input.businessId,
      plan: catalog.plan,
      billingCycle: catalog.billingCycle,
      catalogVersion: catalog.version,
      status: SubscriptionStatus.PENDING,
      provider: this.dependencies.paymentProvider.name,
      externalReference,
      subscriptionAmountCents: catalog.subscriptionAmountCents,
      setupFeeCents: catalog.setupFeeCents,
      currency: catalog.currency,
      idempotencyKey: requestIdempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    const setupTransaction = transaction({
      id: this.dependencies.generateId("payment-transaction"), businessId: input.businessId, subscriptionId,
      provider: this.dependencies.paymentProvider.name, type: PaymentTransactionType.SETUP_FEE,
      amountCents: catalog.setupFeeCents, idempotencyKey: setupIdempotencyKey, now,
    });
    const subscriptionTransaction = transaction({
      id: this.dependencies.generateId("payment-transaction"), businessId: input.businessId, subscriptionId,
      provider: this.dependencies.paymentProvider.name, type: PaymentTransactionType.SUBSCRIPTION,
      amountCents: catalog.subscriptionAmountCents, idempotencyKey: subscriptionIdempotencyKey, now,
    });

    // Local intent and both stable idempotency keys exist before any provider call.
    await this.dependencies.subscriptionRepository.save(subscription);
    await this.dependencies.paymentTransactionRepository.save(setupTransaction);
    await this.dependencies.paymentTransactionRepository.save(subscriptionTransaction);
    return this.completeProviderIntents(subscription, [setupTransaction, subscriptionTransaction], catalog, payerEmail, false);
  }

  private async completeProviderIntents(
    subscription: Subscription,
    transactions: PaymentTransaction[],
    catalog: ReturnType<typeof getPaymentCatalogEntry>,
    payerEmail: string,
    reused: boolean,
  ): Promise<StartSubscriptionResult> {
    const setupTransaction = transactions.find((item) => item.type === PaymentTransactionType.SETUP_FEE);
    const subscriptionTransaction = transactions.find((item) => item.type === PaymentTransactionType.SUBSCRIPTION);
    if (!setupTransaction || !subscriptionTransaction) throw new Error("Subscription payment intents are incomplete");

    let currentSubscription = subscription;
    let currentSetup = setupTransaction;
    let currentRecurring = subscriptionTransaction;

    if (needsProviderAttempt(currentRecurring, currentSubscription.providerSubscriptionId)) {
      try {
        const result = await this.dependencies.paymentProvider.createSubscriptionIntent({
          businessId: subscription.businessId, plan: catalog.plan, billingCycle: catalog.billingCycle, catalog,
          payerEmail, externalReference: subscription.externalReference, idempotencyKey: currentRecurring.idempotencyKey,
        });
        const updatedAt = this.dependencies.now();
        currentSubscription = withSubscriptionProviderResult(currentSubscription, result, updatedAt);
        currentRecurring = withProviderResult(currentRecurring, result, updatedAt, result.providerSubscriptionId);
        await this.dependencies.subscriptionRepository.save(currentSubscription);
        await this.dependencies.paymentTransactionRepository.save(currentRecurring);
      } catch (error) {
        await this.dependencies.paymentTransactionRepository.save(withProviderFailure(currentRecurring, this.dependencies.now()));
        throw error;
      }
    }

    if (needsProviderAttempt(currentSetup, currentSetup.providerPaymentId)) {
      try {
        const result = await this.dependencies.paymentProvider.createSetupFeeIntent({
          businessId: subscription.businessId, catalog, payerEmail, externalReference: `setup:${subscription.id}`,
          idempotencyKey: currentSetup.idempotencyKey,
        });
        currentSetup = withProviderResult(currentSetup, result, this.dependencies.now());
        await this.dependencies.paymentTransactionRepository.save(currentSetup);
      } catch (error) {
        await this.dependencies.paymentTransactionRepository.save(withProviderFailure(currentSetup, this.dependencies.now()));
        throw error;
      }
    }

    return {
      subscription: currentSubscription,
      transactions: [currentSetup, currentRecurring],
      checkoutUrls: {
        ...(currentSubscription.checkoutUrl === undefined ? {} : { subscription: currentSubscription.checkoutUrl }),
        ...(currentSetup.checkoutUrl === undefined ? {} : { setup: currentSetup.checkoutUrl }),
      },
      reused,
    };
  }
}

function transaction(input: {
  id: string; businessId: string; subscriptionId: string; provider: string;
  type: PaymentTransactionType; amountCents: number; idempotencyKey: string; now: string;
}): PaymentTransaction {
  return { ...input, currency: "BRL", status: PaymentTransactionStatus.PENDING, createdAt: input.now, updatedAt: input.now };
}

function withSubscriptionProviderResult(subscription: Subscription, result: ProviderIntentResult, updatedAt: string): Subscription {
  return {
    ...subscription,
    ...(result.providerSubscriptionId === undefined ? {} : { providerSubscriptionId: result.providerSubscriptionId }),
    ...(result.providerStatus === undefined ? {} : { providerStatus: result.providerStatus }),
    ...(result.checkoutUrl === undefined ? {} : { checkoutUrl: result.checkoutUrl }),
    updatedAt,
  };
}

function withProviderResult(transaction: PaymentTransaction, result: ProviderIntentResult, updatedAt: string, preferredProviderId?: string): PaymentTransaction {
  const providerPaymentId = result.providerPaymentId;
  return {
    ...transaction, status: result.status,
    ...(providerPaymentId === undefined ? {} : { providerPaymentId }),
    ...(result.providerSubscriptionId !== undefined ? { providerSubscriptionId: result.providerSubscriptionId } : preferredProviderId !== undefined ? { providerSubscriptionId: preferredProviderId } : {}),
    ...(result.providerStatus === undefined ? {} : { providerStatus: result.providerStatus }),
    ...(result.checkoutUrl === undefined ? {} : { checkoutUrl: result.checkoutUrl }), updatedAt,
  };
}

function withProviderFailure(transaction: PaymentTransaction, updatedAt: string): PaymentTransaction {
  return { ...transaction, status: PaymentTransactionStatus.FAILED, updatedAt };
}

function needsProviderAttempt(transaction: PaymentTransaction, providerId: string | undefined): boolean {
  return providerId === undefined && transaction.status !== PaymentTransactionStatus.CANCELED;
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizePayerEmail(value: string): string {
  const normalized = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("payerEmail is invalid");
  return normalized;
}
