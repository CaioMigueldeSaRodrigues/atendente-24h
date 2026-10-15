import {
  PaymentProviderError,
  type PaymentProviderReadApi,
  ProviderAuthorizedPaymentResource,
  ProviderPaymentResource,
  ProviderSubscriptionResource,
} from "./payment-provider.js";
import type { BusinessPlanAssignmentRepository } from "./business-plan.js";
import { PaymentTransactionStatus, PaymentTransactionType, type PaymentTransaction, type PaymentTransactionRepository } from "./payment-transaction.js";
import { PaymentWebhookProcessingStatus, type PaymentWebhookEvent, type PaymentWebhookEventRepository } from "./payment-webhook-event.js";
import { SubscriptionStatus, type Subscription, type SubscriptionRepository } from "./subscription.js";

export const MercadoPagoWebhookEventType = {
  PAYMENT: "payment",
  SUBSCRIPTION_PREAPPROVAL: "subscription_preapproval",
  SUBSCRIPTION_AUTHORIZED_PAYMENT: "subscription_authorized_payment",
} as const;

export type MercadoPagoWebhookEventType = typeof MercadoPagoWebhookEventType[keyof typeof MercadoPagoWebhookEventType];

export type PaymentWebhookTransaction = {
  run<T>(operation: () => Promise<T>): Promise<T>;
};

export type MercadoPagoWebhookServiceDependencies = {
  webhookEvents: PaymentWebhookEventRepository;
  subscriptions: SubscriptionRepository;
  transactions: PaymentTransactionRepository;
  assignments: BusinessPlanAssignmentRepository;
  provider: PaymentProviderReadApi;
  transaction: PaymentWebhookTransaction;
  now: () => string;
  generateId: (prefix: string) => string;
};

export type MercadoPagoWebhookInput = {
  event: PaymentWebhookEvent;
  eventType: string;
  resourceId: string;
};

export type MercadoPagoWebhookResult = {
  status: "processed" | "ignored" | "duplicate" | "in_progress";
  activated: boolean;
};

export class MercadoPagoWebhookRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MercadoPagoWebhookRejectedError";
  }
}

export class MercadoPagoWebhookTransientError extends Error {
  constructor() {
    super("Mercado Pago webhook verification is temporarily unavailable");
    this.name = "MercadoPagoWebhookTransientError";
  }
}

export class MercadoPagoWebhookService {
  constructor(private readonly dependencies: MercadoPagoWebhookServiceDependencies) {}

  async process(input: MercadoPagoWebhookInput): Promise<MercadoPagoWebhookResult> {
    const claimedEvent = await this.dependencies.webhookEvents.claim({
      ...input.event,
      provider: "mercadopago",
      resourceId: input.resourceId,
      eventType: input.eventType,
      processingStatus: PaymentWebhookProcessingStatus.PROCESSING,
    });
    if (claimedEvent.status === "duplicate") return { status: "duplicate", activated: false };
    if (claimedEvent.status === "in_progress") return { status: "in_progress", activated: false };

    if (!isSupportedEventType(input.eventType)) {
      await this.dependencies.webhookEvents.update({
        ...claimedEvent.event,
        processingStatus: PaymentWebhookProcessingStatus.IGNORED,
        processedAt: this.dependencies.now(),
        errorMessage: "unsupported event type",
      });
      return { status: "ignored", activated: false };
    }

    try {
      const fact = await this.readRemoteFact(input.eventType, input.resourceId);
      return await this.dependencies.transaction.run(async () => {
        const applied = input.eventType === MercadoPagoWebhookEventType.PAYMENT
          ? await this.applyPayment(fact as ProviderPaymentResource)
          : input.eventType === MercadoPagoWebhookEventType.SUBSCRIPTION_PREAPPROVAL
            ? await this.applySubscription(fact as ProviderSubscriptionResource)
            : await this.applyAuthorizedPayment(fact as ProviderAuthorizedPaymentResource);
        const { errorMessage: _errorMessage, ...eventWithoutError } = claimedEvent.event;
        await this.dependencies.webhookEvents.update({
          ...eventWithoutError,
          ...(applied.businessId === undefined ? {} : { businessId: applied.businessId }),
          processingStatus: PaymentWebhookProcessingStatus.PROCESSED,
          processedAt: this.dependencies.now(),
        });
        return { status: "processed", activated: applied.activated };
      });
    } catch (error) {
      if (error instanceof MercadoPagoWebhookRejectedError) {
        await this.dependencies.webhookEvents.update({
          ...claimedEvent.event,
          processingStatus: PaymentWebhookProcessingStatus.IGNORED,
          processedAt: this.dependencies.now(),
          errorMessage: error.message,
        });
        return { status: "ignored", activated: false };
      }
      if (error instanceof PaymentProviderError && error.transient) {
        await this.dependencies.webhookEvents.update({
          ...claimedEvent.event,
          processingStatus: PaymentWebhookProcessingStatus.FAILED,
          errorMessage: "provider verification failed",
        });
        throw new MercadoPagoWebhookTransientError();
      }
      await this.markInternalFailure(claimedEvent.event);
      throw error;
    }
  }

  private async readRemoteFact(eventType: string, resourceId: string): Promise<ProviderPaymentResource | ProviderSubscriptionResource | ProviderAuthorizedPaymentResource> {
    if (eventType === MercadoPagoWebhookEventType.PAYMENT) return this.dependencies.provider.getPayment(resourceId);
    if (eventType === MercadoPagoWebhookEventType.SUBSCRIPTION_PREAPPROVAL) return this.dependencies.provider.getSubscription(resourceId);
    return this.dependencies.provider.getAuthorizedPayment(resourceId);
  }

  private async applySubscription(resource: ProviderSubscriptionResource): Promise<ApplyResult> {
    if (resource.id.trim() === "") throw rejected("subscription id is missing");
    const subscription = await this.dependencies.subscriptions.findByProviderSubscriptionId("mercadopago", resource.id);
    if (subscription === null) throw rejected("subscription correlation failed");
    if (resource.externalReference !== subscription.externalReference) throw rejected("subscription reference mismatch");
    const recurring = resource.autoRecurring;
    if (recurring === undefined
      || recurring.currencyId !== subscription.currency
      || recurring.transactionAmountCents !== subscription.subscriptionAmountCents
      || recurring.frequency !== expectedFrequency(subscription.billingCycle)
      || recurring.frequencyType !== "months") {
      throw rejected("subscription catalog validation failed");
    }
    const status = normalizePreapprovalStatus(subscription, resource.status);
    await this.dependencies.subscriptions.save({ ...subscription, status, providerStatus: resource.status, updatedAt: this.dependencies.now() });
    const activated = await evaluateSubscriptionActivation(subscription.id, subscription.businessId, this.dependencies);
    return { businessId: subscription.businessId, activated };
  }

  private async applyAuthorizedPayment(resource: ProviderAuthorizedPaymentResource): Promise<ApplyResult> {
    if (resource.id.trim() === "" || resource.preapprovalId === undefined || resource.paymentId === undefined) throw rejected("authorized payment correlation failed");
    const subscription = await this.dependencies.subscriptions.findByProviderSubscriptionId("mercadopago", resource.preapprovalId);
    if (subscription === null || (resource.externalReference !== undefined && resource.externalReference !== subscription.externalReference)) throw rejected("authorized payment subscription mismatch");
    if (resource.currencyId !== undefined && resource.currencyId !== subscription.currency) throw rejected("authorized payment currency mismatch");
    if (resource.transactionAmountCents !== undefined && resource.transactionAmountCents !== subscription.subscriptionAmountCents) throw rejected("authorized payment amount mismatch");
    if (resource.status !== undefined && ["rejected", "cancelled", "canceled"].includes(resource.status.toLowerCase())) throw rejected("authorized payment is not approved");
    const payment = await this.dependencies.provider.getPayment(resource.paymentId);
    if (payment.id !== resource.paymentId) throw rejected("authorized payment resource mismatch");
    if (payment.externalReference !== subscription.externalReference || payment.currencyId !== subscription.currency || payment.transactionAmountCents !== subscription.subscriptionAmountCents) throw rejected("recurring payment validation failed");
    const applied = await this.applyPaymentResource(payment, subscription, PaymentTransactionType.SUBSCRIPTION);
    return { businessId: subscription.businessId, activated: applied.activated };
  }

  private async applyPayment(resource: ProviderPaymentResource): Promise<ApplyResult> {
    if (resource.id.trim() === "" || resource.externalReference === undefined) throw rejected("payment correlation data is missing");
    const expectedType = resource.externalReference.startsWith("setup:") ? PaymentTransactionType.SETUP_FEE
      : resource.externalReference.startsWith("subscription:") ? PaymentTransactionType.SUBSCRIPTION : null;
    if (expectedType === null) throw rejected("payment reference format is invalid");
    const subscriptionReference = subscriptionReferenceForPayment(resource.externalReference);
    const subscription = await this.dependencies.subscriptions.findByExternalReference("mercadopago", subscriptionReference);
    if (subscription === null) throw rejected("payment correlation failed");
    return this.applyPaymentResource(resource, subscription, expectedType);
  }

  private async applyPaymentResource(resource: ProviderPaymentResource, subscription: Subscription, expectedType: PaymentTransactionType): Promise<ApplyResult> {
    const expectedReference = expectedType === PaymentTransactionType.SETUP_FEE ? `setup:${subscription.id}` : subscription.externalReference;
    if (resource.externalReference !== expectedReference || resource.currencyId !== subscription.currency) throw rejected("payment catalog validation failed");
    const expectedAmount = expectedType === PaymentTransactionType.SETUP_FEE ? subscription.setupFeeCents : subscription.subscriptionAmountCents;
    if (resource.transactionAmountCents !== expectedAmount) throw rejected("payment amount validation failed");
    const existing = await this.dependencies.transactions.findByProviderPaymentId("mercadopago", resource.id);
    if (existing !== null && (existing.businessId !== subscription.businessId || existing.subscriptionId !== subscription.id || existing.type !== expectedType)) throw rejected("payment tenant correlation failed");
    const transaction = existing ?? await this.findOrCreateTransaction(subscription, expectedType, resource.id);
    const { providerSubscriptionId: _providerSubscriptionId, ...transactionWithoutProviderSubscriptionId } = transaction;
    const updated: PaymentTransaction = {
      ...transactionWithoutProviderSubscriptionId,
      providerPaymentId: resource.id,
      ...(expectedType === PaymentTransactionType.SUBSCRIPTION && subscription.providerSubscriptionId !== undefined
        ? { providerSubscriptionId: subscription.providerSubscriptionId }
        : {}),
      providerStatus: resource.statusDetail ?? resource.status,
      status: paymentTransactionStatus(resource.status, resource.statusDetail),
      updatedAt: this.dependencies.now(),
    };
    await this.dependencies.transactions.save(updated);
    const activated = await evaluateSubscriptionActivation(subscription.id, subscription.businessId, this.dependencies);
    return { businessId: subscription.businessId, activated };
  }

  private async findOrCreateTransaction(subscription: Subscription, type: PaymentTransactionType, providerPaymentId: string): Promise<PaymentTransaction> {
    const transactions = await this.dependencies.transactions.listBySubscription(subscription.businessId, subscription.id);
    const current = transactions.find((item) => item.type === type && (type === PaymentTransactionType.SETUP_FEE || item.providerPaymentId === undefined));
    if (current !== undefined) return current;
    const now = this.dependencies.now();
    return {
      id: this.dependencies.generateId("payment-transaction"),
      businessId: subscription.businessId,
      subscriptionId: subscription.id,
      provider: "mercadopago",
      type,
      amountCents: type === PaymentTransactionType.SETUP_FEE ? subscription.setupFeeCents : subscription.subscriptionAmountCents,
      currency: "BRL",
      status: PaymentTransactionStatus.PENDING,
      idempotencyKey: `${subscription.id}:payment:${providerPaymentId}`,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async markInternalFailure(event: PaymentWebhookEvent): Promise<void> {
    try {
      await this.dependencies.webhookEvents.update({
        ...event,
        processingStatus: PaymentWebhookProcessingStatus.FAILED,
        errorMessage: "internal webhook processing failure",
      });
    } catch {
      // Preserve the original internal/database error. A failed status is best effort
      // here because replacing it would misclassify the failure as provider downtime.
    }
  }
}

export async function evaluateSubscriptionActivation(
  subscriptionId: string,
  businessId: string,
  dependencies: Pick<MercadoPagoWebhookServiceDependencies, "subscriptions" | "transactions" | "assignments" | "now" | "generateId">,
): Promise<boolean> {
  const subscription = await dependencies.subscriptions.findById(businessId, subscriptionId);
  if (subscription === null || subscription.status === SubscriptionStatus.CANCELED || subscription.status === SubscriptionStatus.PAUSED || subscription.status === SubscriptionStatus.FAILED) return false;
  const transactions = await dependencies.transactions.listBySubscription(businessId, subscriptionId);
  const setupPaid = transactions.some((item) => item.type === PaymentTransactionType.SETUP_FEE && item.status === PaymentTransactionStatus.SUCCEEDED && item.providerPaymentId !== undefined);
  const recurringPaid = transactions.some((item) => item.type === PaymentTransactionType.SUBSCRIPTION
    && item.status === PaymentTransactionStatus.SUCCEEDED
    && item.providerPaymentId !== undefined
    && item.providerSubscriptionId === subscription.providerSubscriptionId);
  const subscriptionAuthorized = subscription.providerStatus === "authorized" && subscription.providerSubscriptionId !== undefined;
  if (!setupPaid || !subscriptionAuthorized || !recurringPaid) return false;

  const current = await dependencies.assignments.findCurrent(businessId);
  if (current === null) {
    const now = dependencies.now();
    await dependencies.assignments.save({ id: `mercadopago-${subscription.id}`, businessId, plan: subscription.plan, status: "ACTIVE", startedAt: now, updatedAt: now, source: `mercadopago-subscription:${subscription.id}` });
  } else if (current.plan !== subscription.plan || current.source !== `mercadopago-subscription:${subscription.id}`) {
    const now = dependencies.now();
    await dependencies.assignments.save({ ...current, status: "ENDED", updatedAt: now });
    await dependencies.assignments.save({ id: `mercadopago-${subscription.id}`, businessId, plan: subscription.plan, status: "ACTIVE", startedAt: now, updatedAt: now, source: `mercadopago-subscription:${subscription.id}` });
  }
  if (subscription.status !== SubscriptionStatus.ACTIVE) await dependencies.subscriptions.save({ ...subscription, status: SubscriptionStatus.ACTIVE, updatedAt: dependencies.now() });
  return true;
}

type ApplyResult = { businessId: string; activated: boolean };

function isSupportedEventType(value: string): value is MercadoPagoWebhookEventType {
  return Object.values(MercadoPagoWebhookEventType).includes(value as MercadoPagoWebhookEventType);
}

function expectedFrequency(cycle: Subscription["billingCycle"]): number { return cycle === "MONTHLY" ? 1 : 12; }

function subscriptionReferenceForPayment(reference: string): string {
  return reference.startsWith("setup:") ? `subscription:${reference.slice("setup:".length)}` : reference;
}

function normalizePreapprovalStatus(subscription: Subscription, providerStatus: string): Subscription["status"] {
  const status = providerStatus.toLowerCase();
  if (subscription.status === SubscriptionStatus.CANCELED || subscription.status === SubscriptionStatus.PAUSED || subscription.status === SubscriptionStatus.FAILED) return subscription.status;
  if (status === "canceled") return SubscriptionStatus.CANCELED;
  if (status === "paused") return SubscriptionStatus.PAUSED;
  if (subscription.status === SubscriptionStatus.ACTIVE && status === "authorized") return SubscriptionStatus.ACTIVE;
  return status === "authorized" || status === "pending" ? SubscriptionStatus.PENDING : SubscriptionStatus.FAILED;
}

function paymentTransactionStatus(status: string, statusDetail: string | undefined): PaymentTransactionStatus {
  if (status.toLowerCase() === "approved" && statusDetail?.toLowerCase() === "accredited") return PaymentTransactionStatus.SUCCEEDED;
  if (["rejected", "cancelled", "canceled", "refunded", "charged_back"].includes(status.toLowerCase())) return PaymentTransactionStatus.FAILED;
  return PaymentTransactionStatus.PENDING;
}

function rejected(message: string): MercadoPagoWebhookRejectedError { return new MercadoPagoWebhookRejectedError(message); }
