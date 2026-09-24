import type { Vehicle } from "../../core/domain/entities.js";
import type { VehicleRepository } from "../../core/repositories.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];

export class SupabaseVehicleRepository implements VehicleRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async save(entity: Vehicle): Promise<void> {
    const { error } = await this.client.from("vehicles").upsert(
      this.toRow(entity),
      { onConflict: "business_id,id" },
    );

    if (error) {
      throw new Error("Failed to save Vehicle");
    }
  }

  async findById(businessId: string, id: string): Promise<Vehicle | null> {
    const { data, error } = await this.client
      .from("vehicles")
      .select("*")
      .eq("business_id", businessId)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error("Failed to load Vehicle");
    }

    return data ? this.toDomain(data) : null;
  }

  private toRow(entity: Vehicle): VehicleRow {
    return {
      id: entity.id,
      business_id: entity.businessId,
      customer_id: entity.customerId ?? null,
      brand: entity.brand ?? null,
      model: entity.model ?? null,
      year: entity.year ?? null,
      version: entity.version ?? null,
      license_plate: entity.licensePlate ?? null,
      mileage: entity.mileage ?? null,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    };
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
