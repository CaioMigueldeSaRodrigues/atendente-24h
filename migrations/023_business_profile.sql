CREATE TABLE IF NOT EXISTS business_profiles (
  business_id TEXT PRIMARY KEY REFERENCES automotive_businesses(id),
  address TEXT,
  phone TEXT,
  notify_phone TEXT,
  opening_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  updated_at TEXT NOT NULL
);

-- Same posture as 021: no policies, so only the table owner (the application) reads it.
DO $$
DECLARE
  api_role TEXT;
BEGIN
  EXECUTE format('ALTER TABLE %I.business_profiles ENABLE ROW LEVEL SECURITY', current_schema());
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON %I.business_profiles FROM %I', current_schema(), api_role);
    END IF;
  END LOOP;
END $$;
