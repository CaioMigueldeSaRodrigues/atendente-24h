-- A subscription can have multiple recurring payment transactions over its lifetime.
-- Keep the provider subscription lookup indexed, but do not make it unique per transaction.
DROP INDEX IF EXISTS payment_transactions_provider_subscription_idx;

CREATE INDEX IF NOT EXISTS payment_transactions_provider_subscription_idx
  ON payment_transactions(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
