import { getPaymentCatalogEntry } from "./payment-catalog.js";
import type { PaymentProvider } from "./payment-provider.js";
import { PaymentTransactionStatus, PaymentTransactionType, type PaymentTransaction, type PaymentTransactionRepository } from "./payment-transaction.js";
import { SubscriptionStatus, type Subscription, type SubscriptionRepository } from "./subscription.js";

export type StartSubscriptionInput = {
  businessId: string;
  plan: string;
  billingCycle: string;
  idempotencyKey?: string;
};

export type StartSubscriptionResult = {
  subscription: Subscription;
  transactions: PaymentTransaction[];
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
    const catalog = getPaymentCatalogEntry(input.plan, input.billingCycle);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey) ?? this.dependencies.generateIdempotencyKey();
    const existing = await this.dependencies.subscriptionRepository.findByBusinessAndIdempotencyKey(input.businessId, idempotencyKey);
    if (existing !== null) {
      return {
        subscription: existing,
        transactions: await this.dependencies.paymentTransactionRepository.listBySubscription(input.businessId, existing.id),
        reused: true,
      };
    }

    const now = this.dependencies.now();
    const subscriptionId = this.dependencies.generateId("subscription");
    const externalReference = `subscription:${subscriptionId}`;
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
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    const setupTransaction: PaymentTransaction = transaction({
      id: this.dependencies.generateId("payment-transaction"),
      businessId: input.businessId,
      subscriptionId,
      provider: this.dependencies.paymentProvider.name,
      type: PaymentTransactionType.SETUP_FEE,
      amountCents: catalog.setupFeeCents,
      idempotencyKey: `${idempotencyKey}:setup`,
      now,
    });
    const subscriptionTransaction: PaymentTransaction = transaction({
      id: this.dependencies.generateId("payment-transaction"),
      businessId: input.businessId,
      subscriptionId,
      provider: this.dependencies.paymentProvider.name,
      type: PaymentTransactionType.SUBSCRIPTION,
      amountCents: catalog.subscriptionAmountCents,
      idempotencyKey: `${idempotencyKey}:subscription`,
      now,
    });

    // These local intents must exist before any provider call.
    await this.dependencies.subscriptionRepository.save(subscription);
    await this.dependencies.paymentTransactionRepository.save(setupTransaction);
    await this.dependencies.paymentTransactionRepository.save(subscriptionTransaction);

    const providerSubscription = await this.dependencies.paymentProvider.createSubscriptionIntent({
      businessId: input.businessId,
      plan: catalog.plan,
      billingCycle: catalog.billingCycle,
      catalog,
      externalReference,
      idempotencyKey,
    });
    const providerSetup = await this.dependencies.paymentProvider.createSetupFeeIntent({
      businessId: input.businessId,
      catalog,
      externalReference,
      idempotencyKey: `${idempotencyKey}:setup`,
    });
    const savedSubscription: Subscription = {
      ...subscription,
      ...(providerSubscription.providerSubscriptionId === undefined ? {} : { providerSubscriptionId: providerSubscription.providerSubscriptionId }),
      updatedAt: this.dependencies.now(),
    };
    const updatedAt = this.dependencies.now();
    const savedSetup = withProviderResult(setupTransaction, providerSetup, updatedAt);
    const savedSubscriptionTransaction = withProviderResult(subscriptionTransaction, providerSubscription, updatedAt);
    await this.dependencies.subscriptionRepository.save(savedSubscription);
    await this.dependencies.paymentTransactionRepository.save(savedSetup);
    await this.dependencies.paymentTransactionRepository.save(savedSubscriptionTransaction);
    return { subscription: savedSubscription, transactions: [savedSetup, savedSubscriptionTransaction], reused: false };
  }
}

function transaction(input: {
  id: string;
  businessId: string;
  subscriptionId: string;
  provider: string;
  type: PaymentTransactionType;
  amountCents: number;
  idempotencyKey: string;
  now: string;
}): PaymentTransaction {
  return {
    ...input,
    currency: "BRL",
    status: PaymentTransactionStatus.PENDING,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function withProviderResult(transaction: PaymentTransaction, result: { status: PaymentTransactionStatus; providerPaymentId?: string }, updatedAt: string): PaymentTransaction {
  return {
    ...transaction,
    status: result.status,
    ...(result.providerPaymentId === undefined ? {} : { providerPaymentId: result.providerPaymentId }),
    updatedAt,
  };
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
