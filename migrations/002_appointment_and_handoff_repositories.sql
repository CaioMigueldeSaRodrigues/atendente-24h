CREATE TABLE IF NOT EXISTS appointments (
  id TEXT NOT NULL, business_id TEXT NOT NULL, opportunity_id TEXT, conversation_id TEXT NOT NULL,
  customer_id TEXT, vehicle_id TEXT, requested_date TEXT, requested_time TEXT, confirmed_start_at TEXT,
  status TEXT NOT NULL, request_description TEXT, external_appointment_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(business_id,id),
  FOREIGN KEY(business_id) REFERENCES automotive_businesses(id),
  FOREIGN KEY(business_id,opportunity_id) REFERENCES opportunities(business_id,id),
  FOREIGN KEY(business_id,conversation_id) REFERENCES conversations(business_id,id),
  FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id),
  FOREIGN KEY(business_id,vehicle_id) REFERENCES vehicles(business_id,id)
);
CREATE TABLE IF NOT EXISTS human_handoffs (
  id TEXT NOT NULL, business_id TEXT NOT NULL, conversation_id TEXT NOT NULL, opportunity_id TEXT,
  reason TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL, assigned_to TEXT,
  requested_at TEXT NOT NULL, accepted_at TEXT, resolved_at TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY(business_id,id),
  FOREIGN KEY(business_id) REFERENCES automotive_businesses(id),
  FOREIGN KEY(business_id,conversation_id) REFERENCES conversations(business_id,id),
  FOREIGN KEY(business_id,opportunity_id) REFERENCES opportunities(business_id,id)
);
