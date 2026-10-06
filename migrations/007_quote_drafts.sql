CREATE TABLE IF NOT EXISTS business_assistant_integration_settings (
  business_id TEXT PRIMARY KEY,
  inventory_for_assistant_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  product_pricing_for_assistant_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  labor_pricing_for_assistant_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id) REFERENCES automotive_businesses(id)
);

CREATE TABLE IF NOT EXISTS quote_drafts (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  quote_request_id TEXT NOT NULL,
  vehicle_id TEXT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','SUPERSEDED','PUBLISHED')),
  products_subtotal_amount_cents BIGINT NOT NULL CHECK (products_subtotal_amount_cents >= 0),
  products_subtotal_currency TEXT NOT NULL CHECK (products_subtotal_currency = 'BRL'),
  labor_subtotal_amount_cents BIGINT NOT NULL CHECK (labor_subtotal_amount_cents >= 0),
  labor_subtotal_currency TEXT NOT NULL CHECK (labor_subtotal_currency = 'BRL'),
  total_amount_cents BIGINT NOT NULL CHECK (total_amount_cents >= 0),
  total_currency TEXT NOT NULL CHECK (total_currency = 'BRL'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  authorized_at TEXT,
  PRIMARY KEY (business_id, id),
  UNIQUE (business_id, quote_request_id, revision),
  FOREIGN KEY (business_id) REFERENCES automotive_businesses(id),
  FOREIGN KEY (business_id, conversation_id) REFERENCES conversations(business_id, id),
  FOREIGN KEY (business_id, quote_request_id) REFERENCES quote_requests(business_id, id),
  FOREIGN KEY (business_id, vehicle_id) REFERENCES vehicles(business_id, id)
);

CREATE TABLE IF NOT EXISTS quote_draft_lines (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  quote_draft_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PRODUCT','LABOR')),
  description TEXT NOT NULL,
  external_reference TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  unit_price_captured_amount_cents BIGINT NOT NULL CHECK (unit_price_captured_amount_cents >= 0),
  unit_price_captured_currency TEXT NOT NULL CHECK (unit_price_captured_currency = 'BRL'),
  subtotal_amount_cents BIGINT NOT NULL CHECK (subtotal_amount_cents >= 0),
  subtotal_currency TEXT NOT NULL CHECK (subtotal_currency = 'BRL'),
  source TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (business_id, id),
  FOREIGN KEY (business_id, quote_draft_id) REFERENCES quote_drafts(business_id, id)
);

CREATE INDEX IF NOT EXISTS quote_drafts_business_quote_revision_idx
  ON quote_drafts (business_id, quote_request_id, revision DESC);
CREATE INDEX IF NOT EXISTS quote_draft_lines_business_draft_idx
  ON quote_draft_lines (business_id, quote_draft_id, id);
