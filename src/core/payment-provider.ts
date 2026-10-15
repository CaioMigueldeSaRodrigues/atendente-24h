import type { BillingCycle, PaymentCatalogEntry } from "./payment-catalog.js";
import type { PaymentTransactionStatus } from "./payment-transaction.js";
import type { AdminPlan } from "./admin-plan-entitlement.js";

export type PaymentProviderName = "mock" | "mercadopago";

export class PaymentProviderError extends Error {
  constructor(message: string, readonly transient: boolean) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

/** A provider read/write operation failed transiently outside the domain. */
export class PaymentProviderTransientError extends PaymentProviderError {
  constructor(message = "Payment provider is temporarily unavailable") {
    super(message, true);
    this.name = "PaymentProviderTransientError";
  }
}

export type ProviderSubscriptionIntent = {
  businessId: string;
  plan: AdminPlan;
  billingCycle: BillingCycle;
  catalog: PaymentCatalogEntry;
  payerEmail: string;
  externalReference: string;
  idempotencyKey: string;
};

export type ProviderSetupFeeIntent = {
  businessId: string;
  catalog: PaymentCatalogEntry;
  payerEmail: string;
  externalReference: string;
  idempotencyKey: string;
};

export type ProviderIntentResult = {
  status: PaymentTransactionStatus;
  providerPaymentId?: string;
  providerSubscriptionId?: string;
  checkoutUrl?: string;
  externalReference?: string;
  providerStatus?: string;
};

export type ProviderSubscriptionResource = {
  id: string;
  status: string;
  externalReference?: string;
  payerEmail?: string;
  autoRecurring?: {
    transactionAmountCents: number;
    currencyId: string;
    frequency?: number;
    frequencyType?: string;
  };
};

export type ProviderPaymentResource = {
  id: string;
  status: string;
  statusDetail?: string;
  externalReference?: string;
  transactionAmountCents: number;
  currencyId: string;
};

export type ProviderAuthorizedPaymentResource = {
  id: string;
  preapprovalId?: string;
  status?: string;
  statusDetail?: string;
  externalReference?: string;
  transactionAmountCents?: number;
  currencyId?: string;
  paymentId?: string;
};

export type PaymentProviderReadApi = {
  getSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionResource>;
  getPayment(providerPaymentId: string): Promise<ProviderPaymentResource>;
  getAuthorizedPayment(providerAuthorizedPaymentId: string): Promise<ProviderAuthorizedPaymentResource>;
};

export type PaymentProvider = {
  readonly name: PaymentProviderName;
  createSubscriptionIntent(input: ProviderSubscriptionIntent): Promise<ProviderIntentResult>;
  createSetupFeeIntent(input: ProviderSetupFeeIntent): Promise<ProviderIntentResult>;
  readonly readApi?: PaymentProviderReadApi;
};

export function paymentProviderReadApi(provider: PaymentProvider): PaymentProviderReadApi | null {
  return provider.readApi ?? (isPaymentProviderReadApi(provider) ? provider : null);
}

function isPaymentProviderReadApi(value: PaymentProvider): value is PaymentProvider & PaymentProviderReadApi {
  return typeof (value as Partial<PaymentProviderReadApi>).getSubscription === "function"
    && typeof (value as Partial<PaymentProviderReadApi>).getPayment === "function"
    && typeof (value as Partial<PaymentProviderReadApi>).getAuthorizedPayment === "function";
}
