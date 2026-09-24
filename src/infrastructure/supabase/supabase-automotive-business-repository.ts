import type { AutomotiveBusiness } from "../../core/domain/entities.js";
import { BusinessType } from "../../core/domain/enums.js";
import type { AutomotiveBusinessRepository } from "../../core/repositories.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

type AutomotiveBusinessRow =
  Database["public"]["Tables"]["automotive_businesses"]["Row"];

export class SupabaseAutomotiveBusinessRepository
  implements AutomotiveBusinessRepository
{
  constructor(private readonly client: SupabaseClient<Database>) {}

  async save(entity: AutomotiveBusiness): Promise<void> {
    const { error } = await this.client
      .from("automotive_businesses")
      .upsert(this.toRow(entity), { onConflict: "id" });

    if (error) {
      throw new Error("Failed to save AutomotiveBusiness");
    }
  }

  async findById(id: string): Promise<AutomotiveBusiness | null> {
    const { data, error } = await this.client
      .from("automotive_businesses")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error("Failed to load AutomotiveBusiness");
    }

    return data ? this.toDomain(data) : null;
  }

  private toRow(entity: AutomotiveBusiness): AutomotiveBusinessRow {
    return {
      id: entity.id,
      name: entity.name,
      legal_name: entity.legalName ?? null,
      business_type: entity.businessType,
      phone: entity.phone ?? null,
      email: entity.email ?? null,
      address: entity.address ?? null,
      timezone: entity.timezone,
      active: entity.active,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    };
  }

  private toDomain(row: AutomotiveBusinessRow): AutomotiveBusiness {
    const businessType = Object.values(BusinessType).find(
      (value) => value === row.business_type,
    );

    if (!businessType) {
      throw new Error("Failed to load AutomotiveBusiness");
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
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
