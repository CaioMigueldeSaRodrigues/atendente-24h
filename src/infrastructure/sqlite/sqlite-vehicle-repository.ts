import type { Vehicle } from "../../core/domain/entities.js";
import type { VehicleRepository } from "../../core/repositories.js";
import type { DatabaseSync } from "node:sqlite";

type VehicleRow = {
  id: string;
  business_id: string;
  customer_id: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  version: string | null;
  license_plate: string | null;
  mileage: number | null;
  created_at: string;
  updated_at: string;
};

export class SqliteVehicleRepository implements VehicleRepository {
  constructor(private readonly database: DatabaseSync) {}

  async save(entity: Vehicle): Promise<void> {
    try {
      this.database.prepare(`
        INSERT INTO vehicles (
          id, business_id, customer_id, brand, model, year, version,
          license_plate, mileage, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (business_id, id) DO UPDATE SET
          customer_id = excluded.customer_id,
          brand = excluded.brand,
          model = excluded.model,
          year = excluded.year,
          version = excluded.version,
          license_plate = excluded.license_plate,
          mileage = excluded.mileage,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `).run(
        entity.id,
        entity.businessId,
        entity.customerId ?? null,
        entity.brand ?? null,
        entity.model ?? null,
        entity.year ?? null,
        entity.version ?? null,
        entity.licensePlate ?? null,
        entity.mileage ?? null,
        entity.createdAt,
        entity.updatedAt,
      );
    } catch {
      throw new Error("Failed to save Vehicle");
    }
  }

  async findById(businessId: string, id: string): Promise<Vehicle | null> {
    try {
      const row = this.database.prepare(`
        SELECT * FROM vehicles WHERE business_id = ? AND id = ?
      `).get(businessId, id) as VehicleRow | undefined;

      return row ? this.toDomain(row) : null;
    } catch {
      throw new Error("Failed to load Vehicle");
    }
  }

  private toDomain(row: VehicleRow): Vehicle {
    return {
      id: row.id,
      businessId: row.business_id,
      ...(row.customer_id !== null ? { customerId: row.customer_id } : {}),
      ...(row.brand !== null ? { brand: row.brand } : {}),
      ...(row.model !== null ? { model: row.model } : {}),
      ...(row.year !== null ? { year: row.year } : {}),
      ...(row.version !== null ? { version: row.version } : {}),
      ...(row.license_plate !== null
        ? { licensePlate: row.license_plate }
        : {}),
      ...(row.mileage !== null ? { mileage: row.mileage } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
