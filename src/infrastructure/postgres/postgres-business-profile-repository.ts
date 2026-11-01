import type { BusinessProfile, BusinessProfileRepository } from "../../core/business-profile.js";
import { PostgresDatabase } from "./postgres-database.js";

type Row = Record<string, unknown>;

export class PostgresBusinessProfileRepository implements BusinessProfileRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async findByBusinessId(businessId: string): Promise<BusinessProfile | null> {
    const { rows } = await this.database.query<Row>("SELECT * FROM business_profiles WHERE business_id=$1", [businessId]);
    return rows[0] ? map(rows[0]) : null;
  }

  async save(profile: BusinessProfile): Promise<void> {
    await this.database.query(
      `INSERT INTO business_profiles(business_id,address,phone,notify_phone,opening_hours,services,payment_methods,notes,updated_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9)
       ON CONFLICT(business_id) DO UPDATE SET address=excluded.address,phone=excluded.phone,notify_phone=excluded.notify_phone,
       opening_hours=excluded.opening_hours,services=excluded.services,payment_methods=excluded.payment_methods,notes=excluded.notes,updated_at=excluded.updated_at`,
      [profile.businessId, profile.address ?? null, profile.phone ?? null, profile.notifyPhone ?? null, JSON.stringify(profile.openingHours),
        JSON.stringify(profile.services), JSON.stringify(profile.paymentMethods), profile.notes ?? null, profile.updatedAt],
    );
  }
}

function map(row: Row): BusinessProfile {
  const text = (key: string): string | undefined => row[key] == null ? undefined : String(row[key]);
  const address = text("address"), phone = text("phone"), notifyPhone = text("notify_phone"), notes = text("notes");
  return {
    businessId: String(row.business_id),
    ...(address === undefined ? {} : { address }),
    ...(phone === undefined ? {} : { phone }),
    ...(notifyPhone === undefined ? {} : { notifyPhone }),
    openingHours: row.opening_hours as BusinessProfile["openingHours"],
    services: row.services as string[],
    paymentMethods: row.payment_methods as string[],
    ...(notes === undefined ? {} : { notes }),
    updatedAt: String(row.updated_at),
  };
}
