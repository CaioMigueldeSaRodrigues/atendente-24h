ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS conversation_id TEXT;
ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS sender_jid TEXT;
ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS reply TEXT;
ALTER TABLE evolution_go_webhook_receipts
  ADD COLUMN IF NOT EXISTS sent_at TEXT;
