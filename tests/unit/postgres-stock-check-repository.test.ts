import assert from "node:assert/strict";
import test from "node:test";
import type { PostgresDatabase } from "../../src/infrastructure/postgres/postgres-database.js";
import { InventoryAvailability } from "../../src/core/domain/enums.js";
import { PostgresStockCheckRepository } from "../../src/infrastructure/postgres/postgres-stock-check-repository.js";

const row = {
  id: "stock-a", business_id: "business-a", conversation_id: "conversation-a", quote_request_id: "quote-a", vehicle_id: "vehicle-a",
  requested_item: "Freios", inventory_reference: "sku-a", availability: InventoryAvailability.LOW_STOCK, available_quantity: 2,
  unit: "unidade", source: "fixture", checked_at: "2026-01-01T10:00:00.000Z",
};

test("PostgreSQL StockCheck adapter persists and reads tenant-scoped snapshots with a fake client", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    async query(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      return { rows: text.includes("SELECT") ? [row] : [] };
    },
  } as unknown as PostgresDatabase;
  const repository = new PostgresStockCheckRepository(db);
  const entity = { id: "stock-a", businessId: "business-a", conversationId: "conversation-a", quoteRequestId: "quote-a", vehicleId: "vehicle-a", requestedItem: "Freios", inventoryReference: "sku-a", availability: InventoryAvailability.LOW_STOCK, availableQuantity: 2, unit: "unidade", source: "fixture", checkedAt: "2026-01-01T10:00:00.000Z" } as const;
  await repository.save(entity);
  assert.equal((await repository.findLatestByQuoteRequest("business-a", "quote-a"))?.availability, InventoryAvailability.LOW_STOCK);
  assert.equal((await repository.listByBusiness("business-a", { availability: InventoryAvailability.LOW_STOCK, requestedItem: "freios" })).length, 1);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.text.includes("business_id")));
  assert.ok(calls.some((call) => call.values.includes("business-a")));
});
