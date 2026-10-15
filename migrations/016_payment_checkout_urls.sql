-- Persists provider checkout links so idempotent retries return the existing intent
-- without creating a second Mercado Pago subscription or preference.
ALTER TABLE saas_subscriptions ADD COLUMN IF NOT EXISTS checkout_url TEXT;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS checkout_url TEXT;
