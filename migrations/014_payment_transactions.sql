CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES automotive_businesses(id),
  subscription_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('SETUP_FEE','SUBSCRIPTION')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL CHECK (currency = 'BRL'),
  status TEXT NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','CANCELED')),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (business_id, id),
  UNIQUE (business_id, idempotency_key),
  FOREIGN KEY (business_id, subscription_id) REFERENCES saas_subscriptions(business_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_payment_idx
  ON payment_transactions(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_transactions_business_created_idx
  ON payment_transactions(business_id, created_at, id);

CREATE INDEX IF NOT EXISTS payment_transactions_subscription_idx
  ON payment_transactions(business_id, subscription_id, created_at);
