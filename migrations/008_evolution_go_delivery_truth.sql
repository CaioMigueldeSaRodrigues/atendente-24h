ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS provider_status TEXT NOT NULL DEFAULT 'ACCEPTED_BY_PROVIDER';
ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS provider_accepted_at TEXT;
ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS delivered_at TEXT;
ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS read_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS evolution_go_webhook_receipts_provider_message_idx
  ON evolution_go_webhook_receipts (business_id, instance_name, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS evolution_go_delivery_receipts (
  business_id TEXT NOT NULL REFERENCES automotive_businesses(id),
  instance_name TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  provider_status TEXT NOT NULL CHECK (provider_status IN ('DELIVERED', 'READ')),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (business_id, instance_name, provider_message_id, provider_status)
);
