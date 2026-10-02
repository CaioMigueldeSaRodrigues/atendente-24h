import type { StockCheck } from "../../core/domain/entities.js";
import { InventoryAvailability } from "../../core/domain/enums.js";
import type { StockCheckListFilters, StockCheckRepository } from "../../core/repositories.js";
import type { PostgresDatabase } from "./postgres-database.js";

type Row = Record<string, unknown>;
const text = (row: Row, key: string): string => String(row[key]);
const optionalText = (row: Row, key: string): string | undefined => row[key] == null ? undefined : String(row[key]);

function map(row: Row): StockCheck {
  const vehicleId = optionalText(row, "vehicle_id"); const unit = optionalText(row, "unit");
  return {
    id: text(row, "id"), businessId: text(row, "business_id"), conversationId: text(row, "conversation_id"), quoteRequestId: text(row, "quote_request_id"),
    ...(vehicleId === undefined ? {} : { vehicleId }), requestedItem: text(row, "requested_item"), inventoryReference: text(row, "inventory_reference"),
    availability: text(row, "availability") as InventoryAvailability, ...(row.available_quantity == null ? {} : { availableQuantity: Number(row.available_quantity) }),
    ...(unit === undefined ? {} : { unit }), source: text(row, "source"), checkedAt: text(row, "checked_at"),
  };
}

export class PostgresStockCheckRepository implements StockCheckRepository {
  constructor(private readonly db: PostgresDatabase) {}
  async save(entity: StockCheck): Promise<void> {
    try { await this.db.query(`INSERT INTO stock_checks(id,business_id,conversation_id,quote_request_id,vehicle_id,requested_item,inventory_reference,availability,available_quantity,unit,source,checked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(business_id,id) DO UPDATE SET conversation_id=excluded.conversation_id,quote_request_id=excluded.quote_request_id,vehicle_id=excluded.vehicle_id,requested_item=excluded.requested_item,inventory_reference=excluded.inventory_reference,availability=excluded.availability,available_quantity=excluded.available_quantity,unit=excluded.unit,source=excluded.source,checked_at=excluded.checked_at`, [entity.id,entity.businessId,entity.conversationId,entity.quoteRequestId,entity.vehicleId??null,entity.requestedItem,entity.inventoryReference,entity.availability,entity.availableQuantity??null,entity.unit??null,entity.source,entity.checkedAt]); }
    catch { throw new Error("Failed to save StockCheck"); }
  }
  async findLatestByQuoteRequest(businessId: string, quoteRequestId: string): Promise<StockCheck | null> {
    try { const { rows } = await this.db.query("SELECT * FROM stock_checks WHERE business_id=$1 AND quote_request_id=$2 ORDER BY checked_at DESC,id DESC LIMIT 1", [businessId,quoteRequestId]); return rows[0] ? map(rows[0]) : null; }
    catch { throw new Error("Failed to load StockCheck"); }
  }
  async listByBusiness(businessId: string, filters: StockCheckListFilters = {}): Promise<StockCheck[]> {
    const values: unknown[] = [businessId]; const clauses = ["business_id=$1"];
    if (filters.from !== undefined) { values.push(filters.from); clauses.push(`checked_at >= $${values.length}`); }
    if (filters.to !== undefined) { values.push(filters.to); clauses.push(`checked_at < $${values.length}`); }
    if (filters.availability !== undefined) { values.push(filters.availability); clauses.push(`availability = $${values.length}`); }
    if (filters.requestedItem !== undefined) { values.push(`%${filters.requestedItem}%`); clauses.push(`LOWER(TRIM(requested_item)) LIKE LOWER(TRIM($${values.length}))`); }
    try { const { rows } = await this.db.query(`SELECT * FROM stock_checks WHERE ${clauses.join(" AND ")} ORDER BY checked_at DESC,id DESC`, values); return rows.map(map); }
    catch { throw new Error("Failed to load StockChecks"); }
  }
}
