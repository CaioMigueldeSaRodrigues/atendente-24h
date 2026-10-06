import { DatabaseSync } from "node:sqlite";

export type SqliteDatabaseOptions = {
  filename: string;
};

const INITIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS automotive_businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    legal_name TEXT,
    business_type TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    timezone TEXT NOT NULL,
    active INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS business_plan_assignments (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    plan TEXT NOT NULL CHECK (plan IN ('BASIC','INTERMEDIATE','ADVANCED')),
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','ENDED')),
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS business_plan_assignments_current_idx
    ON business_plan_assignments (business_id) WHERE status = 'ACTIVE';
  CREATE INDEX IF NOT EXISTS business_plan_assignments_plan_started_idx
    ON business_plan_assignments (plan, started_at);

  CREATE TABLE IF NOT EXISTS evolution_go_webhook_receipts (
    business_id TEXT NOT NULL,
    instance_name TEXT NOT NULL,
    external_message_id TEXT NOT NULL,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    conversation_id TEXT,
    sender_jid TEXT,
    reply TEXT,
    sent_at TEXT,
    PRIMARY KEY (business_id, instance_name, external_message_id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id)
  );

  CREATE TABLE IF NOT EXISTS evolution_go_webhook_claims (
    business_id TEXT NOT NULL,
    instance_name TEXT NOT NULL,
    external_message_id TEXT NOT NULL,
    claim_token TEXT NOT NULL,
    received_at TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    lease_until TEXT NOT NULL,
    PRIMARY KEY (business_id, instance_name, external_message_id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id)
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    name TEXT,
    primary_phone TEXT,
    email TEXT,
    preferred_contact_channel TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id)
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    customer_id TEXT,
    brand TEXT,
    model TEXT,
    year INTEGER,
    version TEXT,
    license_plate TEXT,
    mileage INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id),
    FOREIGN KEY (business_id, customer_id)
      REFERENCES customers(business_id, id)
  );

  CREATE INDEX IF NOT EXISTS vehicles_business_customer_idx
    ON vehicles (business_id, customer_id);

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    customer_id TEXT,
    vehicle_id TEXT,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    commercial_outcome TEXT,
    current_intent TEXT,
    started_at TEXT NOT NULL,
    last_message_at TEXT NOT NULL,
    closed_at TEXT,
    PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id),
    FOREIGN KEY (business_id, customer_id)
      REFERENCES customers(business_id, id),
    FOREIGN KEY (business_id, vehicle_id)
      REFERENCES vehicles(business_id, id)
  );

  CREATE INDEX IF NOT EXISTS conversations_business_customer_idx
    ON conversations (business_id, customer_id);
  CREATE INDEX IF NOT EXISTS conversations_business_vehicle_idx
    ON conversations (business_id, vehicle_id);
  CREATE INDEX IF NOT EXISTS conversations_business_status_idx
    ON conversations (business_id, status);

  CREATE TABLE IF NOT EXISTS evolution_go_conversation_links (
    business_id TEXT NOT NULL,
    instance_name TEXT NOT NULL,
    sender_jid TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (business_id, instance_name, sender_jid),
    FOREIGN KEY (business_id, conversation_id)
      REFERENCES conversations(business_id, id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    content TEXT NOT NULL,
    external_message_id TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id),
    FOREIGN KEY (business_id, conversation_id)
      REFERENCES conversations(business_id, id)
  );

  CREATE INDEX IF NOT EXISTS messages_business_conversation_created_idx
    ON messages (business_id, conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    customer_id TEXT,
    vehicle_id TEXT,
    request_description TEXT,
    status TEXT NOT NULL,
    next_action TEXT,
    estimated_value_amount_cents INTEGER
      CHECK (estimated_value_amount_cents IS NULL OR typeof(estimated_value_amount_cents) = 'integer'),
    estimated_value_currency TEXT,
    realized_value_amount_cents INTEGER
      CHECK (realized_value_amount_cents IS NULL OR typeof(realized_value_amount_cents) = 'integer'),
    realized_value_currency TEXT,
    value_source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT,
    PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id),
    FOREIGN KEY (business_id, conversation_id)
      REFERENCES conversations(business_id, id),
    FOREIGN KEY (business_id, customer_id)
      REFERENCES customers(business_id, id),
    FOREIGN KEY (business_id, vehicle_id)
      REFERENCES vehicles(business_id, id)
  );

  CREATE INDEX IF NOT EXISTS opportunities_business_conversation_idx
    ON opportunities (business_id, conversation_id);
  CREATE INDEX IF NOT EXISTS opportunities_business_customer_idx
    ON opportunities (business_id, customer_id);
  CREATE INDEX IF NOT EXISTS opportunities_business_vehicle_idx
    ON opportunities (business_id, vehicle_id);
  CREATE INDEX IF NOT EXISTS opportunities_business_status_idx
    ON opportunities (business_id, status);

  CREATE TABLE IF NOT EXISTS quote_requests (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    customer_id TEXT,
    vehicle_id TEXT,
    request_description TEXT NOT NULL,
    symptom_description TEXT,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    responded_at TEXT,
    authorized_price_amount_cents INTEGER
      CHECK (authorized_price_amount_cents IS NULL OR typeof(authorized_price_amount_cents) = 'integer'),
    authorized_price_currency TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id),
    FOREIGN KEY (business_id, opportunity_id)
      REFERENCES opportunities(business_id, id),
    FOREIGN KEY (business_id, conversation_id)
      REFERENCES conversations(business_id, id),
    FOREIGN KEY (business_id, customer_id)
      REFERENCES customers(business_id, id),
    FOREIGN KEY (business_id, vehicle_id)
      REFERENCES vehicles(business_id, id)
  );

  CREATE INDEX IF NOT EXISTS quote_requests_business_opportunity_idx
    ON quote_requests (business_id, opportunity_id);
  CREATE INDEX IF NOT EXISTS quote_requests_business_conversation_idx
    ON quote_requests (business_id, conversation_id);
  CREATE INDEX IF NOT EXISTS quote_requests_business_customer_idx
    ON quote_requests (business_id, customer_id);
  CREATE INDEX IF NOT EXISTS quote_requests_business_vehicle_idx
    ON quote_requests (business_id, vehicle_id);
  CREATE INDEX IF NOT EXISTS quote_requests_business_status_idx
    ON quote_requests (business_id, status);

  CREATE TABLE IF NOT EXISTS commercial_events (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    conversation_id TEXT,
    customer_id TEXT,
    vehicle_id TEXT,
    opportunity_id TEXT,
    quote_request_id TEXT,
    channel TEXT,
    intent TEXT,
    commercial_outcome TEXT,
    business_type TEXT,
    country TEXT,
    state TEXT,
    city TEXT,
    region TEXT,
    category TEXT,
    requested_item TEXT,
    symptom TEXT,
    vehicle_brand TEXT,
    vehicle_model TEXT,
    vehicle_year INTEGER,
    amount_cents INTEGER CHECK (
      amount_cents IS NULL OR
      (typeof(amount_cents) = 'integer' AND amount_cents >= 0 AND amount_cents <= 9007199254740991)
    ),
    currency TEXT CHECK (currency IS NULL OR currency = 'BRL'),
    occurred_at TEXT NOT NULL,
    CHECK (
      (amount_cents IS NULL AND currency IS NULL)
      OR
      (amount_cents IS NOT NULL AND currency IS NOT NULL)
    ),
    PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id)
  );

  CREATE INDEX IF NOT EXISTS commercial_events_business_occurred_idx
    ON commercial_events (business_id, occurred_at);
  CREATE INDEX IF NOT EXISTS commercial_events_business_type_occurred_idx
    ON commercial_events (business_id, event_type, occurred_at);
  CREATE INDEX IF NOT EXISTS commercial_events_business_conversation_occurred_idx
    ON commercial_events (business_id, conversation_id, occurred_at);
  CREATE INDEX IF NOT EXISTS commercial_events_business_requested_item_occurred_idx
    ON commercial_events (business_id, requested_item, occurred_at);
  CREATE INDEX IF NOT EXISTS commercial_events_business_category_occurred_idx
    ON commercial_events (business_id, category, occurred_at);
  CREATE INDEX IF NOT EXISTS commercial_events_business_state_occurred_idx
    ON commercial_events (business_id, state, occurred_at);
  CREATE INDEX IF NOT EXISTS commercial_events_business_region_occurred_idx
    ON commercial_events (business_id, region, occurred_at);
  CREATE INDEX IF NOT EXISTS commercial_events_business_business_type_occurred_idx
    ON commercial_events (business_id, business_type, occurred_at);

  CREATE TABLE IF NOT EXISTS assistant_health_events (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    conversation_id TEXT,
    opportunity_id TEXT,
    quote_request_id TEXT,
    channel TEXT,
    business_type TEXT,
    country TEXT,
    state TEXT,
    city TEXT,
    region TEXT,
    provider TEXT,
    model TEXT,
    reason TEXT,
    occurred_at TEXT NOT NULL,
    PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id)
  );

  CREATE INDEX IF NOT EXISTS assistant_health_events_business_occurred_idx
    ON assistant_health_events (business_id, occurred_at);
  CREATE INDEX IF NOT EXISTS assistant_health_events_business_type_occurred_idx
    ON assistant_health_events (business_id, event_type, occurred_at);
  CREATE INDEX IF NOT EXISTS assistant_health_events_business_conversation_occurred_idx
    ON assistant_health_events (business_id, conversation_id, occurred_at);
  CREATE INDEX IF NOT EXISTS assistant_health_events_business_business_type_occurred_idx
    ON assistant_health_events (business_id, business_type, occurred_at);
  CREATE INDEX IF NOT EXISTS assistant_health_events_business_region_occurred_idx
    ON assistant_health_events (business_id, region, occurred_at);

  CREATE TABLE IF NOT EXISTS outbound_deliveries (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    message_id TEXT,
    quote_request_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient_ref TEXT,
    status TEXT NOT NULL CHECK (status IN (
      'PENDING', 'SENDING', 'DELIVERED', 'FAILED_RETRYABLE', 'FAILED_FINAL'
    )),
    attempts INTEGER NOT NULL CHECK (typeof(attempts) = 'integer' AND attempts >= 0),
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
    FOREIGN KEY (business_id, message_id)
      REFERENCES messages(business_id, id),
    FOREIGN KEY (business_id, quote_request_id)
      REFERENCES quote_requests(business_id, id),
    FOREIGN KEY (business_id, conversation_id)
      REFERENCES conversations(business_id, id)
  );

  CREATE INDEX IF NOT EXISTS outbound_deliveries_business_status_idx
    ON outbound_deliveries (business_id, status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS outbound_deliveries_business_message_idx
    ON outbound_deliveries (business_id, message_id);
  CREATE INDEX IF NOT EXISTS outbound_deliveries_business_quote_idx
    ON outbound_deliveries (business_id, quote_request_id, channel);
  CREATE INDEX IF NOT EXISTS outbound_deliveries_business_lease_idx
    ON outbound_deliveries (business_id, status, lease_until, next_attempt_at);

  CREATE TABLE IF NOT EXISTS stock_checks (
    id TEXT NOT NULL,
    business_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    quote_request_id TEXT NOT NULL,
    vehicle_id TEXT,
    requested_item TEXT NOT NULL,
    inventory_reference TEXT NOT NULL,
    availability TEXT NOT NULL CHECK (availability IN ('AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN')),
    available_quantity INTEGER CHECK (available_quantity IS NULL OR (typeof(available_quantity) = 'integer' AND available_quantity >= 0)),
    unit TEXT,
    source TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id),
    FOREIGN KEY (business_id, conversation_id) REFERENCES conversations(business_id, id),
    FOREIGN KEY (business_id, quote_request_id) REFERENCES quote_requests(business_id, id),
    FOREIGN KEY (business_id, vehicle_id) REFERENCES vehicles(business_id, id)
  );

  CREATE INDEX IF NOT EXISTS stock_checks_business_checked_idx
    ON stock_checks (business_id, checked_at);
  CREATE INDEX IF NOT EXISTS stock_checks_business_quote_idx
    ON stock_checks (business_id, quote_request_id, checked_at);
  CREATE INDEX IF NOT EXISTS stock_checks_business_item_idx
    ON stock_checks (business_id, requested_item, checked_at);

  CREATE TABLE IF NOT EXISTS business_assistant_integration_settings (
    business_id TEXT PRIMARY KEY,
    inventory_for_assistant_enabled INTEGER NOT NULL DEFAULT 0 CHECK (inventory_for_assistant_enabled IN (0,1)),
    product_pricing_for_assistant_enabled INTEGER NOT NULL DEFAULT 0 CHECK (product_pricing_for_assistant_enabled IN (0,1)),
    labor_pricing_for_assistant_enabled INTEGER NOT NULL DEFAULT 0 CHECK (labor_pricing_for_assistant_enabled IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (business_id) REFERENCES automotive_businesses(id)
  );

  CREATE TABLE IF NOT EXISTS quote_drafts (
    id TEXT NOT NULL, business_id TEXT NOT NULL, conversation_id TEXT NOT NULL, quote_request_id TEXT NOT NULL,
    vehicle_id TEXT, revision INTEGER NOT NULL CHECK (revision > 0),
    status TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','SUPERSEDED','PUBLISHED')),
    products_subtotal_amount_cents INTEGER NOT NULL CHECK (products_subtotal_amount_cents >= 0), products_subtotal_currency TEXT NOT NULL CHECK (products_subtotal_currency = 'BRL'),
    labor_subtotal_amount_cents INTEGER NOT NULL CHECK (labor_subtotal_amount_cents >= 0), labor_subtotal_currency TEXT NOT NULL CHECK (labor_subtotal_currency = 'BRL'),
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents >= 0), total_currency TEXT NOT NULL CHECK (total_currency = 'BRL'),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, authorized_at TEXT,
    PRIMARY KEY (business_id, id), UNIQUE (business_id, quote_request_id, revision), FOREIGN KEY (business_id) REFERENCES automotive_businesses(id),
    FOREIGN KEY (business_id, conversation_id) REFERENCES conversations(business_id, id),
    FOREIGN KEY (business_id, quote_request_id) REFERENCES quote_requests(business_id, id),
    FOREIGN KEY (business_id, vehicle_id) REFERENCES vehicles(business_id, id)
  );

  CREATE TABLE IF NOT EXISTS quote_draft_lines (
    id TEXT NOT NULL, business_id TEXT NOT NULL, quote_draft_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('PRODUCT','LABOR')), description TEXT NOT NULL, external_reference TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0), unit TEXT NOT NULL,
    unit_price_captured_amount_cents INTEGER NOT NULL CHECK (unit_price_captured_amount_cents >= 0), unit_price_captured_currency TEXT NOT NULL CHECK (unit_price_captured_currency = 'BRL'),
    subtotal_amount_cents INTEGER NOT NULL CHECK (subtotal_amount_cents >= 0), subtotal_currency TEXT NOT NULL CHECK (subtotal_currency = 'BRL'),
    source TEXT NOT NULL, checked_at TEXT NOT NULL, PRIMARY KEY (business_id, id),
    FOREIGN KEY (business_id, quote_draft_id) REFERENCES quote_drafts(business_id, id)
  );
  CREATE INDEX IF NOT EXISTS quote_drafts_business_quote_revision_idx ON quote_drafts (business_id, quote_request_id, revision DESC);
  CREATE INDEX IF NOT EXISTS quote_draft_lines_business_draft_idx ON quote_draft_lines (business_id, quote_draft_id, id);
`;

export function createSqliteDatabase({ filename }: SqliteDatabaseOptions) {
  const database = new DatabaseSync(filename);

  try {
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec("PRAGMA busy_timeout = 5000;");
    if (filename !== ":memory:") {
      database.exec("PRAGMA journal_mode = WAL;");
    }
    initializeSqliteSchema(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function initializeSqliteSchema(database: DatabaseSync): void {
  database.exec(INITIAL_SCHEMA);
  migrateEvolutionGoWebhookReceipts(database);
}

function migrateEvolutionGoWebhookReceipts(database: DatabaseSync): void {
  const columns = new Set(
    (database.prepare("PRAGMA table_info(evolution_go_webhook_receipts)").all() as Array<{ name: string }>)
      .map(({ name }) => name),
  );
  const additions = [
    ["status", "TEXT NOT NULL DEFAULT 'sent'"],
    ["conversation_id", "TEXT"],
    ["sender_jid", "TEXT"],
    ["reply", "TEXT"],
    ["sent_at", "TEXT"],
  ] as const;
  for (const [name, definition] of additions) {
    if (!columns.has(name)) database.exec(`ALTER TABLE evolution_go_webhook_receipts ADD COLUMN ${name} ${definition}`);
  }
}
