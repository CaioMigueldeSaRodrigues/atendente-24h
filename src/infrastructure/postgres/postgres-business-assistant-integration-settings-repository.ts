import type { BusinessAssistantIntegrationSettings, BusinessAssistantIntegrationSettingsRepository } from "../../core/business-assistant-integration-settings.js";
import { PostgresDatabase } from "./postgres-database.js";

type Row = Record<string, unknown>;
export class PostgresBusinessAssistantIntegrationSettingsRepository implements BusinessAssistantIntegrationSettingsRepository {
  constructor(private readonly database: PostgresDatabase) {}
  async findByBusinessId(businessId: string): Promise<BusinessAssistantIntegrationSettings | null> { const result = await this.database.query<Row>("SELECT * FROM business_assistant_integration_settings WHERE business_id=$1", [businessId]); return result.rows[0] ? map(result.rows[0]) : null; }
  async save(value: BusinessAssistantIntegrationSettings): Promise<void> { await this.database.query("INSERT INTO business_assistant_integration_settings(business_id,inventory_for_assistant_enabled,product_pricing_for_assistant_enabled,labor_pricing_for_assistant_enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(business_id) DO UPDATE SET inventory_for_assistant_enabled=excluded.inventory_for_assistant_enabled,product_pricing_for_assistant_enabled=excluded.product_pricing_for_assistant_enabled,labor_pricing_for_assistant_enabled=excluded.labor_pricing_for_assistant_enabled,updated_at=excluded.updated_at", [value.businessId, value.inventoryForAssistantEnabled, value.productPricingForAssistantEnabled, value.laborPricingForAssistantEnabled, value.createdAt, value.updatedAt]); }
}
function map(row: Row): BusinessAssistantIntegrationSettings { return { businessId: String(row.business_id), inventoryForAssistantEnabled: row.inventory_for_assistant_enabled === true, productPricingForAssistantEnabled: row.product_pricing_for_assistant_enabled === true, laborPricingForAssistantEnabled: row.labor_pricing_for_assistant_enabled === true, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
