import type { PaymentProvider, ProviderIntentResult, ProviderSetupFeeIntent, ProviderSubscriptionIntent } from "../../core/payment-provider.js";
import { PaymentTransactionStatus } from "../../core/payment-transaction.js";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;

  async createSubscriptionIntent(input: ProviderSubscriptionIntent): Promise<ProviderIntentResult> {
    return {
      status: PaymentTransactionStatus.PENDING,
      providerSubscriptionId: `mock-subscription-${safeId(input.idempotencyKey)}`,
    };
  }

  async createSetupFeeIntent(input: ProviderSetupFeeIntent): Promise<ProviderIntentResult> {
    return {
      status: PaymentTransactionStatus.PENDING,
      providerPaymentId: `mock-payment-${safeId(input.idempotencyKey)}`,
    };
  }
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
