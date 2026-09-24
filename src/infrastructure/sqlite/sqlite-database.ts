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
