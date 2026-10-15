ALTER TABLE outbound_deliveries
  ALTER COLUMN quote_request_id DROP NOT NULL;

ALTER TABLE outbound_deliveries
  ADD COLUMN IF NOT EXISTS appointment_id TEXT;

ALTER TABLE outbound_deliveries
  DROP CONSTRAINT IF EXISTS outbound_deliveries_business_id_quote_request_id_channel_key;

ALTER TABLE outbound_deliveries
  ADD CONSTRAINT outbound_deliveries_exactly_one_subject_check
  CHECK ((quote_request_id IS NOT NULL AND appointment_id IS NULL)
      OR (quote_request_id IS NULL AND appointment_id IS NOT NULL));

ALTER TABLE outbound_deliveries
  ADD CONSTRAINT outbound_deliveries_appointment_fk
  FOREIGN KEY (business_id, appointment_id)
  REFERENCES appointments(business_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS outbound_deliveries_business_quote_channel_idx
  ON outbound_deliveries (business_id, quote_request_id, channel)
  WHERE quote_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS outbound_deliveries_business_appointment_channel_idx
  ON outbound_deliveries (business_id, appointment_id, channel)
  WHERE appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS outbound_deliveries_business_appointment_idx
  ON outbound_deliveries (business_id, appointment_id, channel)
  WHERE appointment_id IS NOT NULL;
