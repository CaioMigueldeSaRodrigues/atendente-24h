ALTER TABLE payment_webhook_events
  ADD COLUMN IF NOT EXISTS live_mode BOOLEAN;

CREATE INDEX IF NOT EXISTS payment_webhook_events_live_mode_idx
  ON payment_webhook_events(provider, live_mode, received_at);
