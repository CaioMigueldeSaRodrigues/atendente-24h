CREATE TABLE IF NOT EXISTS business_billing_profiles (
  business_id TEXT PRIMARY KEY REFERENCES automotive_businesses(id) ON DELETE CASCADE,
  payer_email TEXT NOT NULL CHECK (payer_email <> ''),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (payer_email = lower(payer_email)),
  CHECK (payer_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
);
