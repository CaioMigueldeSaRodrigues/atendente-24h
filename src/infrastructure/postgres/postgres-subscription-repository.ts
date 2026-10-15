import type { PostgresDatabase } from "./postgres-database.js";
import type { Subscription, SubscriptionRepository } from "../../core/subscription.js";
import { AdminPlan, type AdminPlan as AdminPlanType } from "../../core/admin-plan-entitlement.js";
import { BillingCycle, type BillingCycle as BillingCycleType } from "../../core/payment-catalog.js";
import { SubscriptionStatus, type SubscriptionStatus as SubscriptionStatusType } from "../../core/subscription.js";

type Row = Record<string, unknown>;

export class PostgresSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async save(subscription: Subscription): Promise<void> {
    await this.database.query(`
      INSERT INTO saas_subscriptions(
        id,business_id,plan,billing_cycle,catalog_version,status,provider,
        provider_subscription_id,external_reference,subscription_amount_cents,
        setup_fee_cents,currency,idempotency_key,checkout_url,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (id) DO UPDATE SET
        status=excluded.status,
        provider=excluded.provider,
        provider_subscription_id=excluded.provider_subscription_id,
        checkout_url=excluded.checkout_url,
        updated_at=excluded.updated_at
    `, [
      subscription.id, subscription.businessId, subscription.plan, subscription.billingCycle,
      subscription.catalogVersion, subscription.status, subscription.provider,
      subscription.providerSubscriptionId ?? null, subscription.externalReference,
      subscription.subscriptionAmountCents, subscription.setupFeeCents, subscription.currency,
      subscription.idempotencyKey, subscription.checkoutUrl ?? null, subscription.createdAt, subscription.updatedAt,
    ]);
  }

  async findById(businessId: string, subscriptionId: string): Promise<Subscription | null> {
    const result = await this.database.query<Row>("SELECT * FROM saas_subscriptions WHERE business_id=$1 AND id=$2", [businessId, subscriptionId]);
    return result.rows[0] === undefined ? null : map(result.rows[0]);
  }

  async findByBusinessAndIdempotencyKey(businessId: string, idempotencyKey: string): Promise<Subscription | null> {
    const result = await this.database.query<Row>("SELECT * FROM saas_subscriptions WHERE business_id=$1 AND idempotency_key=$2", [businessId, idempotencyKey]);
    return result.rows[0] === undefined ? null : map(result.rows[0]);
  }
}

function map(row: Row): Subscription {
  const plan = String(row.plan);
  const billingCycle = String(row.billing_cycle);
  const status = String(row.status);
  if (!Object.values(AdminPlan).includes(plan as AdminPlanType)) throw new Error("Invalid persisted subscription plan");
  if (!Object.values(BillingCycle).includes(billingCycle as BillingCycleType)) throw new Error("Invalid persisted subscription billing cycle");
  if (!Object.values(SubscriptionStatus).includes(status as SubscriptionStatusType)) throw new Error("Invalid persisted subscription status");
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    plan: plan as AdminPlanType,
    billingCycle: billingCycle as BillingCycleType,
    catalogVersion: String(row.catalog_version),
    status: status as SubscriptionStatusType,
    provider: String(row.provider),
    ...(row.provider_subscription_id == null ? {} : { providerSubscriptionId: String(row.provider_subscription_id) }),
    ...(row.checkout_url == null ? {} : { checkoutUrl: String(row.checkout_url) }),
    externalReference: String(row.external_reference),
    subscriptionAmountCents: integer(row.subscription_amount_cents),
    setupFeeCents: integer(row.setup_fee_cents),
    currency: String(row.currency) as "BRL",
    idempotencyKey: String(row.idempotency_key),
    createdAt: dateText(row.created_at),
    updatedAt: dateText(row.updated_at),
  };
}

function integer(value: unknown): number { return Number(value); }
function dateText(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
