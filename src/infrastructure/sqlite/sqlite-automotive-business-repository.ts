import type { AutomotiveBusiness } from "../../core/domain/entities.js";
import { BusinessType } from "../../core/domain/enums.js";
import type { AutomotiveBusinessRepository } from "../../core/repositories.js";
import type { DatabaseSync } from "node:sqlite";

type AutomotiveBusinessRow = {
  id: string;
  name: string;
  legal_name: string | null;
  business_type: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  active: number;
  created_at: string;
  updated_at: string;
};

export class SqliteAutomotiveBusinessRepository
  implements AutomotiveBusinessRepository
{
  constructor(private readonly database: DatabaseSync) {}

  async save(entity: AutomotiveBusiness): Promise<void> {
    try {
      this.database.prepare(`
        INSERT INTO automotive_businesses (
          id, name, legal_name, business_type, phone, email, address,
          timezone, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          legal_name = excluded.legal_name,
          business_type = excluded.business_type,
          phone = excluded.phone,
          email = excluded.email,
          address = excluded.address,
          timezone = excluded.timezone,
          active = excluded.active,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `).run(
        entity.id,
        entity.name,
        entity.legalName ?? null,
        entity.businessType,
        entity.phone ?? null,
        entity.email ?? null,
        entity.address ?? null,
        entity.timezone,
        entity.active ? 1 : 0,
        entity.createdAt,
        entity.updatedAt,
      );
    } catch {
      throw new Error("Failed to save AutomotiveBusiness");
    }
  }

  async findById(id: string): Promise<AutomotiveBusiness | null> {
    try {
      const row = this.database
        .prepare("SELECT * FROM automotive_businesses WHERE id = ?")
        .get(id) as AutomotiveBusinessRow | undefined;

      return row ? this.toDomain(row) : null;
    } catch {
      throw new Error("Failed to load AutomotiveBusiness");
    }
  }

  private toDomain(row: AutomotiveBusinessRow): AutomotiveBusiness {
    const businessType = Object.values(BusinessType).find(
      (value) => value === row.business_type,
    );
    if (!businessType) {
      throw new Error("Invalid BusinessType");
    }

    return {
      id: row.id,
      name: row.name,
      ...(row.legal_name !== null ? { legalName: row.legal_name } : {}),
      businessType,
      ...(row.phone !== null ? { phone: row.phone } : {}),
      ...(row.email !== null ? { email: row.email } : {}),
      ...(row.address !== null ? { address: row.address } : {}),
      timezone: row.timezone,
      active: row.active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
