CREATE TABLE IF NOT EXISTS stock_checks (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  quote_request_id TEXT NOT NULL,
  vehicle_id TEXT,
  requested_item TEXT NOT NULL,
  inventory_reference TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (availability IN ('AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN')),
  available_quantity INTEGER CHECK (available_quantity IS NULL OR (available_quantity >= 0)),
  unit TEXT,
  source TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (business_id, id),
  FOREIGN KEY (business_id) REFERENCES automotive_businesses(id),
  FOREIGN KEY (business_id, conversation_id) REFERENCES conversations(business_id, id),
  FOREIGN KEY (business_id, quote_request_id) REFERENCES quote_requests(business_id, id),
  FOREIGN KEY (business_id, vehicle_id) REFERENCES vehicles(business_id, id)
);

CREATE INDEX IF NOT EXISTS stock_checks_business_checked_idx ON stock_checks (business_id, checked_at);
CREATE INDEX IF NOT EXISTS stock_checks_business_quote_idx ON stock_checks (business_id, quote_request_id, checked_at);
CREATE INDEX IF NOT EXISTS stock_checks_business_item_idx ON stock_checks (business_id, requested_item, checked_at);
