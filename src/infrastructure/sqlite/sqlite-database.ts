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
`;

export function createSqliteDatabase({ filename }: SqliteDatabaseOptions) {
  const database = new DatabaseSync(filename);

  try {
    database.exec("PRAGMA foreign_keys = ON;");
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
}
