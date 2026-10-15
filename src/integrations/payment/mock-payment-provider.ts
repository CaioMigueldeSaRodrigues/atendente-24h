import type { PaymentProvider, ProviderAuthorizedPaymentResource, ProviderIntentResult, ProviderPaymentResource, ProviderSetupFeeIntent, ProviderSubscriptionIntent, ProviderSubscriptionResource } from "../../core/payment-provider.js";
import { PaymentTransactionStatus } from "../../core/payment-transaction.js";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionResource> {
    return { id: providerSubscriptionId, status: "pending" };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPaymentResource> {
    return { id: providerPaymentId, status: "pending", transactionAmountCents: 0, currencyId: "BRL" };
  }

  async getAuthorizedPayment(providerAuthorizedPaymentId: string): Promise<ProviderAuthorizedPaymentResource> {
    return { id: providerAuthorizedPaymentId };
  }

  async createSubscriptionIntent(input: ProviderSubscriptionIntent): Promise<ProviderIntentResult> {
    return {
      status: PaymentTransactionStatus.PENDING,
      providerSubscriptionId: `mock-subscription-${safeId(input.idempotencyKey)}`,
      checkoutUrl: `https://mock.local/subscriptions/${safeId(input.idempotencyKey)}`,
      providerStatus: "pending",
    };
  }

  async createSetupFeeIntent(input: ProviderSetupFeeIntent): Promise<ProviderIntentResult> {
    return {
      status: PaymentTransactionStatus.PENDING,
      providerPaymentId: `mock-payment-${safeId(input.idempotencyKey)}`,
      checkoutUrl: `https://mock.local/setup/${safeId(input.idempotencyKey)}`,
      providerStatus: "pending",
    };
  }
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
