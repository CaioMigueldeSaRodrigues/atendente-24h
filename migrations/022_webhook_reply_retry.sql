ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS retry_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS next_retry_at TEXT;

CREATE INDEX IF NOT EXISTS evolution_go_webhook_receipts_pending_reply_idx
  ON evolution_go_webhook_receipts (next_retry_at, received_at)
  WHERE status = 'processed';

CREATE INDEX IF NOT EXISTS messages_business_external_message_idx
  ON messages (business_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
