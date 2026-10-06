import type { DatabaseSync } from "node:sqlite";
import type { BusinessAssistantIntegrationSettings, BusinessAssistantIntegrationSettingsRepository } from "../../core/business-assistant-integration-settings.js";
import { withSqliteConnectionLock } from "./sqlite-connection-lock.js";

type Row = Record<string, unknown>;
export class SqliteBusinessAssistantIntegrationSettingsRepository implements BusinessAssistantIntegrationSettingsRepository {
  constructor(private readonly database: DatabaseSync) {}
  async findByBusinessId(businessId: string): Promise<BusinessAssistantIntegrationSettings | null> {
    const row = await withSqliteConnectionLock(this.database, () => this.database.prepare("SELECT * FROM business_assistant_integration_settings WHERE business_id = ?").get(businessId) as Row | undefined);
    return row ? map(row) : null;
  }
  async save(value: BusinessAssistantIntegrationSettings): Promise<void> {
    await withSqliteConnectionLock(this.database, () => this.database.prepare(`INSERT INTO business_assistant_integration_settings(business_id,inventory_for_assistant_enabled,product_pricing_for_assistant_enabled,labor_pricing_for_assistant_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET inventory_for_assistant_enabled=excluded.inventory_for_assistant_enabled,product_pricing_for_assistant_enabled=excluded.product_pricing_for_assistant_enabled,labor_pricing_for_assistant_enabled=excluded.labor_pricing_for_assistant_enabled,updated_at=excluded.updated_at`).run(value.businessId, value.inventoryForAssistantEnabled ? 1 : 0, value.productPricingForAssistantEnabled ? 1 : 0, value.laborPricingForAssistantEnabled ? 1 : 0, value.createdAt, value.updatedAt));
  }
}
function map(row: Row): BusinessAssistantIntegrationSettings { return { businessId: String(row.business_id), inventoryForAssistantEnabled: Number(row.inventory_for_assistant_enabled) === 1, productPricingForAssistantEnabled: Number(row.product_pricing_for_assistant_enabled) === 1, laborPricingForAssistantEnabled: Number(row.labor_pricing_for_assistant_enabled) === 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
