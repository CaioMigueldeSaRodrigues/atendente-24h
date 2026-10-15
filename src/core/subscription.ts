import type { AdminPlan } from "./admin-plan-entitlement.js";
import type { BillingCycle } from "./payment-catalog.js";

export const SubscriptionStatus = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCELED: "CANCELED",
  FAILED: "FAILED",
} as const;

export type SubscriptionStatus = typeof SubscriptionStatus[keyof typeof SubscriptionStatus];

export type Subscription = {
  id: string;
  businessId: string;
  plan: AdminPlan;
  billingCycle: BillingCycle;
  catalogVersion: string;
  status: SubscriptionStatus;
  provider: string;
  providerSubscriptionId?: string;
  externalReference: string;
  subscriptionAmountCents: number;
  setupFeeCents: number;
  currency: "BRL";
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionRepository = {
  save(subscription: Subscription): Promise<void>;
  findById(businessId: string, subscriptionId: string): Promise<Subscription | null>;
  findByBusinessAndIdempotencyKey(businessId: string, idempotencyKey: string): Promise<Subscription | null>;
};
