-- No policies on purpose: the application connects as table owner, which bypasses RLS,
-- and every other role (including Supabase anon/authenticated) reads nothing.
DO $$
DECLARE
  target RECORD;
  api_role TEXT;
BEGIN
  FOR target IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', current_schema(), target.tablename);
  END LOOP;
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', current_schema(), api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', current_schema(), api_role);
    END IF;
  END LOOP;
END $$;
