CREATE TABLE IF NOT EXISTS business_plan_assignments (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('BASIC','INTERMEDIATE','ADVANCED')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','ENDED')),
  started_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (business_id, id),
  FOREIGN KEY (business_id) REFERENCES automotive_businesses(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_plan_assignments_current_idx
  ON business_plan_assignments (business_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS business_plan_assignments_plan_started_idx
  ON business_plan_assignments (plan, started_at, business_id);
