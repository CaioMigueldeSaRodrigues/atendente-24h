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
