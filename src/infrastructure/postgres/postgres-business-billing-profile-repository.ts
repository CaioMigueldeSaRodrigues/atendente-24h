import type { BusinessBillingProfile, BusinessBillingProfileRepository } from "../../core/business-billing-profile.js";
import type { PostgresDatabase } from "./postgres-database.js";

type Row = Record<string, unknown>;

export class PostgresBusinessBillingProfileRepository implements BusinessBillingProfileRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async findByBusinessId(businessId: string): Promise<BusinessBillingProfile | null> {
    const result = await this.database.query<Row>("SELECT * FROM business_billing_profiles WHERE business_id=$1", [businessId]);
    const row = result.rows[0];
    return row === undefined ? null : map(row);
  }

  async save(profile: BusinessBillingProfile): Promise<void> {
    await this.database.query(`
      INSERT INTO business_billing_profiles(business_id,payer_email,created_at,updated_at)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (business_id) DO UPDATE SET payer_email=excluded.payer_email,updated_at=excluded.updated_at
    `, [profile.businessId, profile.payerEmail, profile.createdAt, profile.updatedAt]);
  }
}

function map(row: Row): BusinessBillingProfile {
  return {
    businessId: String(row.business_id),
    payerEmail: String(row.payer_email),
    createdAt: dateText(row.created_at),
    updatedAt: dateText(row.updated_at),
  };
}

function dateText(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
