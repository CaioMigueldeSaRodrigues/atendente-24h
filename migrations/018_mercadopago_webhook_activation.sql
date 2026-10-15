ALTER TABLE saas_subscriptions
  ADD COLUMN IF NOT EXISTS provider_status TEXT;

ALTER TABLE saas_subscriptions
  DROP CONSTRAINT IF EXISTS saas_subscriptions_status_check;

ALTER TABLE saas_subscriptions
  ADD CONSTRAINT saas_subscriptions_status_check
  CHECK (status IN ('PENDING','ACTIVE','PAST_DUE','PAUSED','CANCELED','FAILED'));

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT;

UPDATE payment_transactions
SET provider_subscription_id = provider_payment_id,
    provider_payment_id = NULL
WHERE type = 'SUBSCRIPTION'
  AND provider_subscription_id IS NULL
  AND provider_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_subscription_idx
  ON payment_transactions(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_webhook_events_processing_idx
  ON payment_webhook_events(provider, processing_status, received_at);
