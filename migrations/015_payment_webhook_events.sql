CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES automotive_businesses(id),
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  provider_request_id TEXT,
  resource_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED','IGNORED')),
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_provider_event_idx
  ON payment_webhook_events(provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_webhook_events_provider_request_idx
  ON payment_webhook_events(provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_webhook_events_business_received_idx
  ON payment_webhook_events(business_id, received_at, id);
