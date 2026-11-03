-- Erases one customer of one workshop (LGPD request): the person, the vehicles, the conversations and everything that hangs from them.
-- Usage: psql -v ON_ERROR_STOP=1 -v business_id=<business> -v customer_id=<customer> -f scripts/erase-customer.sql
-- Find the customer first: SELECT id, name, primary_phone FROM customers WHERE business_id = '<business>' AND primary_phone LIKE '%<digits>';
-- It runs in one transaction: it all happens or none of it does. Backups keep the data until they rotate (14 days).
-- Kept on purpose, anonymized: AI usage and commercial/health events (they count money and demand, not people).
BEGIN;

CREATE TEMPORARY TABLE erase_conversations ON COMMIT DROP AS
  SELECT id FROM conversations WHERE business_id = :'business_id' AND customer_id = :'customer_id';

CREATE TEMPORARY TABLE erase_quotes ON COMMIT DROP AS
  SELECT id FROM quote_requests WHERE business_id = :'business_id'
    AND (customer_id = :'customer_id' OR conversation_id IN (SELECT id FROM erase_conversations));

DELETE FROM quote_draft_lines WHERE business_id = :'business_id' AND quote_draft_id IN
  (SELECT id FROM quote_drafts WHERE business_id = :'business_id'
    AND (conversation_id IN (SELECT id FROM erase_conversations) OR quote_request_id IN (SELECT id FROM erase_quotes)));
DELETE FROM quote_drafts WHERE business_id = :'business_id'
  AND (conversation_id IN (SELECT id FROM erase_conversations) OR quote_request_id IN (SELECT id FROM erase_quotes));
DELETE FROM stock_checks WHERE business_id = :'business_id'
  AND (conversation_id IN (SELECT id FROM erase_conversations) OR quote_request_id IN (SELECT id FROM erase_quotes));
DELETE FROM outbound_deliveries WHERE business_id = :'business_id'
  AND (conversation_id IN (SELECT id FROM erase_conversations) OR quote_request_id IN (SELECT id FROM erase_quotes));
DELETE FROM human_handoffs WHERE business_id = :'business_id' AND conversation_id IN (SELECT id FROM erase_conversations);
DELETE FROM appointments WHERE business_id = :'business_id' AND (customer_id = :'customer_id' OR conversation_id IN (SELECT id FROM erase_conversations));
DELETE FROM quote_requests WHERE business_id = :'business_id' AND id IN (SELECT id FROM erase_quotes);
DELETE FROM opportunities WHERE business_id = :'business_id' AND (customer_id = :'customer_id' OR conversation_id IN (SELECT id FROM erase_conversations));

UPDATE commercial_events SET customer_id = NULL, vehicle_id = NULL, conversation_id = NULL, opportunity_id = NULL, quote_request_id = NULL, requested_item = NULL, symptom = NULL
  WHERE business_id = :'business_id' AND (customer_id = :'customer_id' OR conversation_id IN (SELECT id FROM erase_conversations));
UPDATE assistant_health_events SET conversation_id = NULL, opportunity_id = NULL, quote_request_id = NULL
  WHERE business_id = :'business_id' AND conversation_id IN (SELECT id FROM erase_conversations);
UPDATE ai_usage_events SET conversation_id = NULL
  WHERE business_id = :'business_id' AND conversation_id IN (SELECT id FROM erase_conversations);

-- The receipts only guard against a provider replaying a message, so the row stays and loses everything about the person.
UPDATE evolution_go_webhook_receipts SET sender_jid = NULL, conversation_id = NULL, reply = NULL, status = 'sent'
  WHERE business_id = :'business_id' AND conversation_id IN (SELECT id FROM erase_conversations);
DELETE FROM evolution_go_conversation_links WHERE business_id = :'business_id' AND conversation_id IN (SELECT id FROM erase_conversations);

DELETE FROM messages WHERE business_id = :'business_id' AND conversation_id IN (SELECT id FROM erase_conversations);
DELETE FROM conversations WHERE business_id = :'business_id' AND id IN (SELECT id FROM erase_conversations);
DELETE FROM vehicles WHERE business_id = :'business_id' AND customer_id = :'customer_id';
DELETE FROM customers WHERE business_id = :'business_id' AND id = :'customer_id';

COMMIT;
