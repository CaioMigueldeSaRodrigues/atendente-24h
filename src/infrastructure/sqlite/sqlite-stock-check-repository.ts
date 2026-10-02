import type { DatabaseSync } from "node:sqlite";
import type { StockCheck } from "../../core/domain/entities.js";
import { InventoryAvailability } from "../../core/domain/enums.js";
import type { StockCheckListFilters, StockCheckRepository } from "../../core/repositories.js";
import { withSqliteConnectionLock } from "./sqlite-connection-lock.js";

type Row = Record<string, any>;
const value = (row: Row, key: string): any => row[key];
const text = (row: Row, key: string): string => String(row[key]);
const optionalText = (row: Row, key: string): string | undefined => row[key] == null ? undefined : String(row[key]);

function map(row: Row): StockCheck {
  const vehicleId = optionalText(row, "vehicle_id");
  const unit = optionalText(row, "unit");
  const quantity = value(row, "available_quantity");
  return {
    id: text(row, "id"), businessId: text(row, "business_id"), conversationId: text(row, "conversation_id"), quoteRequestId: text(row, "quote_request_id"),
    ...(vehicleId === undefined ? {} : { vehicleId }), requestedItem: text(row, "requested_item"), inventoryReference: text(row, "inventory_reference"),
    availability: text(row, "availability") as InventoryAvailability, ...(quantity === null ? {} : { availableQuantity: Number(quantity) }),
    ...(unit === undefined ? {} : { unit }), source: text(row, "source"), checkedAt: text(row, "checked_at"),
  };
}

export class SqliteStockCheckRepository implements StockCheckRepository {
  constructor(private readonly database: DatabaseSync) {}
  async save(entity: StockCheck): Promise<void> {
    await withSqliteConnectionLock(this.database, () => this.database.prepare(`
      INSERT INTO stock_checks(id,business_id,conversation_id,quote_request_id,vehicle_id,requested_item,inventory_reference,availability,available_quantity,unit,source,checked_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(business_id,id) DO UPDATE SET conversation_id=excluded.conversation_id,quote_request_id=excluded.quote_request_id,vehicle_id=excluded.vehicle_id,requested_item=excluded.requested_item,inventory_reference=excluded.inventory_reference,availability=excluded.availability,available_quantity=excluded.available_quantity,unit=excluded.unit,source=excluded.source,checked_at=excluded.checked_at
    `).run(entity.id, entity.businessId, entity.conversationId, entity.quoteRequestId, entity.vehicleId ?? null, entity.requestedItem, entity.inventoryReference, entity.availability, entity.availableQuantity ?? null, entity.unit ?? null, entity.source, entity.checkedAt));
  }
  async findLatestByQuoteRequest(businessId: string, quoteRequestId: string): Promise<StockCheck | null> {
    const row = await withSqliteConnectionLock(this.database, () => this.database.prepare("SELECT * FROM stock_checks WHERE business_id = ? AND quote_request_id = ? ORDER BY checked_at DESC, id DESC LIMIT 1").get(businessId, quoteRequestId) as Row | undefined);
    return row ? map(row) : null;
  }
  async listByBusiness(businessId: string, filters: StockCheckListFilters = {}): Promise<StockCheck[]> {
    const params: any[] = [businessId]; const clauses = ["business_id = ?"];
    if (filters.from !== undefined) { clauses.push("checked_at >= ?"); params.push(filters.from); }
    if (filters.to !== undefined) { clauses.push("checked_at < ?"); params.push(filters.to); }
    if (filters.availability !== undefined) { clauses.push("availability = ?"); params.push(filters.availability); }
    if (filters.requestedItem !== undefined) { clauses.push("LOWER(TRIM(requested_item)) LIKE LOWER(TRIM(?))"); params.push(`%${filters.requestedItem}%`); }
    const rows = await withSqliteConnectionLock(this.database, () => this.database.prepare(`SELECT * FROM stock_checks WHERE ${clauses.join(" AND ")} ORDER BY checked_at DESC,id DESC`).all(...params) as Row[]);
    return rows.map(map);
  }
}
