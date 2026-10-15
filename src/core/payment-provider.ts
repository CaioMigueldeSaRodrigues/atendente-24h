import type { BillingCycle, PaymentCatalogEntry } from "./payment-catalog.js";
import type { PaymentTransactionStatus } from "./payment-transaction.js";
import type { AdminPlan } from "./admin-plan-entitlement.js";

export type PaymentProviderName = "mock" | "mercadopago";

export type ProviderSubscriptionIntent = {
  businessId: string;
  plan: AdminPlan;
  billingCycle: BillingCycle;
  catalog: PaymentCatalogEntry;
  externalReference: string;
  idempotencyKey: string;
};

export type ProviderSetupFeeIntent = {
  businessId: string;
  catalog: PaymentCatalogEntry;
  externalReference: string;
  idempotencyKey: string;
};

export type ProviderIntentResult = {
  status: PaymentTransactionStatus;
  providerPaymentId?: string;
  providerSubscriptionId?: string;
};

export type PaymentProvider = {
  readonly name: PaymentProviderName;
  createSubscriptionIntent(input: ProviderSubscriptionIntent): Promise<ProviderIntentResult>;
  createSetupFeeIntent(input: ProviderSetupFeeIntent): Promise<ProviderIntentResult>;
};
