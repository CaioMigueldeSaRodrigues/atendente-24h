import type { Customer } from "../../core/domain/entities.js";
import { Channel } from "../../core/domain/enums.js";
import type { CustomerRepository } from "../../core/repositories.js";
import type { DatabaseSync } from "node:sqlite";

type CustomerRow = {
  id: string;
  business_id: string;
  name: string | null;
  primary_phone: string | null;
  email: string | null;
  preferred_contact_channel: string | null;
  created_at: string;
  updated_at: string;
};

export class SqliteCustomerRepository implements CustomerRepository {
  constructor(private readonly database: DatabaseSync) {}

  async save(entity: Customer): Promise<void> {
    try {
      this.database.prepare(`
        INSERT INTO customers (
          id, business_id, name, primary_phone, email,
          preferred_contact_channel, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (business_id, id) DO UPDATE SET
          name = excluded.name,
          primary_phone = excluded.primary_phone,
          email = excluded.email,
          preferred_contact_channel = excluded.preferred_contact_channel,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `).run(
        entity.id,
        entity.businessId,
        entity.name ?? null,
        entity.primaryPhone ?? null,
        entity.email ?? null,
        entity.preferredContactChannel ?? null,
        entity.createdAt,
        entity.updatedAt,
      );
    } catch {
      throw new Error("Failed to save Customer");
    }
  }

  async findById(businessId: string, id: string): Promise<Customer | null> {
    try {
      const row = this.database.prepare(`
        SELECT * FROM customers WHERE business_id = ? AND id = ?
      `).get(businessId, id) as CustomerRow | undefined;

      return row ? this.toDomain(row) : null;
    } catch {
      throw new Error("Failed to load Customer");
    }
  }

  private toDomain(row: CustomerRow): Customer {
    const preferredContactChannel = row.preferred_contact_channel === null
      ? undefined
      : Object.values(Channel).find(
        (channel) => channel === row.preferred_contact_channel,
      );

    if (
      row.preferred_contact_channel !== null &&
      preferredContactChannel === undefined
    ) {
      throw new Error("Invalid preferred contact channel");
    }

    return {
      id: row.id,
      businessId: row.business_id,
      ...(row.name !== null ? { name: row.name } : {}),
      ...(row.primary_phone !== null ? { primaryPhone: row.primary_phone } : {}),
      ...(row.email !== null ? { email: row.email } : {}),
      ...(preferredContactChannel !== undefined
        ? { preferredContactChannel }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
