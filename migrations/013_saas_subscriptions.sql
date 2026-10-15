CREATE TABLE IF NOT EXISTS saas_subscriptions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES automotive_businesses(id),
  plan TEXT NOT NULL CHECK (plan IN ('BASIC','INTERMEDIATE','ADVANCED')),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('MONTHLY','ANNUAL')),
  catalog_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','PAST_DUE','CANCELED','FAILED')),
  provider TEXT NOT NULL,
  provider_subscription_id TEXT,
  external_reference TEXT NOT NULL UNIQUE,
  subscription_amount_cents BIGINT NOT NULL CHECK (subscription_amount_cents > 0),
  setup_fee_cents BIGINT NOT NULL CHECK (setup_fee_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'BRL'),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (business_id, id),
  UNIQUE (business_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS saas_subscriptions_provider_subscription_idx
  ON saas_subscriptions(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS saas_subscriptions_business_status_idx
  ON saas_subscriptions(business_id, status, created_at);
