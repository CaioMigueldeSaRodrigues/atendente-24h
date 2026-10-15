import { AdminPlan, type AdminPlan as AdminPlanType } from "./admin-plan-entitlement.js";

export const BillingCycle = {
  MONTHLY: "MONTHLY",
  ANNUAL: "ANNUAL",
} as const;

export type BillingCycle = typeof BillingCycle[keyof typeof BillingCycle];

export type PaymentCatalogEntry = {
  plan: AdminPlanType;
  billingCycle: BillingCycle;
  subscriptionAmountCents: number;
  setupFeeCents: number;
  currency: "BRL";
  version: string;
  effectiveFrom: string;
};

const CATALOG_VERSION = "2026-10-15-v1";
const EFFECTIVE_FROM = "2026-10-15T00:00:00.000Z";

const CATALOG: readonly PaymentCatalogEntry[] = [
  entry(AdminPlan.BASIC, BillingCycle.MONTHLY, 39_700, 49_000),
  entry(AdminPlan.INTERMEDIATE, BillingCycle.MONTHLY, 69_700, 89_000),
  entry(AdminPlan.ADVANCED, BillingCycle.MONTHLY, 119_700, 149_000),
  entry(AdminPlan.BASIC, BillingCycle.ANNUAL, 397_000, 49_000),
  entry(AdminPlan.INTERMEDIATE, BillingCycle.ANNUAL, 697_000, 89_000),
  entry(AdminPlan.ADVANCED, BillingCycle.ANNUAL, 1_197_000, 149_000),
];

export function findPaymentCatalogEntry(plan: string, billingCycle: string): PaymentCatalogEntry | null {
  return CATALOG.find((candidate) => candidate.plan === plan && candidate.billingCycle === billingCycle) ?? null;
}

export function getPaymentCatalogEntry(plan: string, billingCycle: string): PaymentCatalogEntry {
  const found = findPaymentCatalogEntry(plan, billingCycle);
  if (found === null) throw new Error("Invalid payment plan or billing cycle");
  return found;
}

export function listPaymentCatalog(): readonly PaymentCatalogEntry[] {
  return CATALOG;
}

function entry(plan: AdminPlanType, billingCycle: BillingCycle, subscriptionAmountCents: number, setupFeeCents: number): PaymentCatalogEntry {
  return {
    plan,
    billingCycle,
    subscriptionAmountCents,
    setupFeeCents,
    currency: "BRL",
    version: CATALOG_VERSION,
    effectiveFrom: EFFECTIVE_FROM,
  };
}
