CREATE TABLE IF NOT EXISTS outbound_deliveries (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  message_id TEXT,
  quote_request_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENDING', 'DELIVERED', 'FAILED_RETRYABLE', 'FAILED_FINAL')),
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  last_error TEXT,
  provider_message_id TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  claimed_at TEXT,
  lease_until TEXT,
  claim_token TEXT,
  PRIMARY KEY (business_id, id),
  UNIQUE (business_id, message_id, channel),
  UNIQUE (business_id, quote_request_id, channel),
  FOREIGN KEY (business_id, message_id) REFERENCES messages(business_id, id),
  FOREIGN KEY (business_id, quote_request_id) REFERENCES quote_requests(business_id, id),
  FOREIGN KEY (business_id, conversation_id) REFERENCES conversations(business_id, id)
);

CREATE INDEX IF NOT EXISTS outbound_deliveries_business_status_idx
  ON outbound_deliveries (business_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS outbound_deliveries_business_message_idx
  ON outbound_deliveries (business_id, message_id);
CREATE INDEX IF NOT EXISTS outbound_deliveries_business_quote_idx
  ON outbound_deliveries (business_id, quote_request_id, channel);
CREATE INDEX IF NOT EXISTS outbound_deliveries_business_lease_idx
  ON outbound_deliveries (business_id, status, lease_until, next_attempt_at);
