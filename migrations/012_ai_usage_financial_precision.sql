-- Preserve sub-cent AI costs at event capture time. Cent rounding belongs to
-- a later billing or presentation layer.
ALTER TABLE ai_usage_events
  ALTER COLUMN cost_usd TYPE NUMERIC(30,15),
  ALTER COLUMN fx_rate TYPE NUMERIC(30,15),
  ALTER COLUMN cost_brl TYPE NUMERIC(30,15),
  ALTER COLUMN billable_brl TYPE NUMERIC(30,15);
