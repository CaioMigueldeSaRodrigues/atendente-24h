import type { Customer } from "../../core/domain/entities.js";
import { Channel } from "../../core/domain/enums.js";
import type { CustomerRepository } from "../../core/repositories.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];

export class SupabaseCustomerRepository implements CustomerRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async save(entity: Customer): Promise<void> {
    const { error } = await this.client.from("customers").upsert(
      this.toRow(entity),
      { onConflict: "business_id,id" },
    );

    if (error) {
      throw new Error("Failed to save Customer");
    }
  }

  async findById(businessId: string, id: string): Promise<Customer | null> {
    const { data, error } = await this.client
      .from("customers")
      .select("*")
      .eq("business_id", businessId)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error("Failed to load Customer");
    }

    return data ? this.toDomain(data) : null;
  }

  private toRow(entity: Customer): CustomerRow {
    return {
      id: entity.id,
      business_id: entity.businessId,
      name: entity.name ?? null,
      primary_phone: entity.primaryPhone ?? null,
      email: entity.email ?? null,
      preferred_contact_channel: entity.preferredContactChannel ?? null,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    };
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
      throw new Error("Failed to load Customer");
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
