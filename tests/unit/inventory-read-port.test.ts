import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkInventory } from "../../src/core/check-inventory.js";
import { InventoryAvailability } from "../../src/core/domain/enums.js";
import { LocalInventoryReadAdapter, UnavailableInventoryReadAdapter } from "../../src/infrastructure/inventory/local-inventory-read-adapter.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";
import { SqliteStockCheckRepository } from "../../src/infrastructure/sqlite/sqlite-stock-check-repository.js";

test("local inventory adapter exposes all read-only availability states", async () => {
  const adapter = new LocalInventoryReadAdapter([
    { requestedItem: "troca de óleo", availability: InventoryAvailability.AVAILABLE, availableQuantity: 8, unit: "unidade", source: "fixture" },
    { requestedItem: "pastilhas", availability: InventoryAvailability.LOW_STOCK, availableQuantity: 2, source: "fixture" },
    { requestedItem: "para-brisa", availability: InventoryAvailability.OUT_OF_STOCK, availableQuantity: 0, source: "fixture" },
  ]);
  assert.equal((await adapter.check({ businessId: "business-a", requestedItem: " TROCA   DE ÓLEO " })).availability, InventoryAvailability.AVAILABLE);
  assert.equal((await adapter.check({ businessId: "business-a", requestedItem: "pastilhas" })).availability, InventoryAvailability.LOW_STOCK);
  assert.equal((await adapter.check({ businessId: "business-a", requestedItem: "para-brisa" })).availability, InventoryAvailability.OUT_OF_STOCK);
  assert.equal((await adapter.check({ businessId: "business-a", requestedItem: "desconhecido" })).availability, InventoryAvailability.UNKNOWN);
  assert.equal((await new UnavailableInventoryReadAdapter().check({ businessId: "business-a", requestedItem: "qualquer" })).source, "provider-unavailable");
  assert.equal("reserve" in adapter, false);
  assert.equal("adjust" in adapter, false);
});

test("inventory application persists a StockCheck and converts provider failure to UNKNOWN", async () => {
  const saved: any[] = [];
  const repository = {
    save: async (entity: any) => { saved.push(entity); },
    findLatestByQuoteRequest: async () => saved.at(-1) ?? null,
    listByBusiness: async () => saved,
  };
  const result = await checkInventory({ businessId: "business-a", conversationId: "conversation-a", quoteRequestId: "quote-a", vehicleId: "vehicle-a", requestedItem: "Freios" }, {
    check: async () => { throw new Error("provider unavailable"); },
  }, repository, { now: () => "2026-09-29T10:30:00.000Z", generateId: () => "stock-check-a" });
  assert.equal(result.availability, InventoryAvailability.UNKNOWN);
  assert.equal(result.source, "provider-error");
  assert.equal(result.conversationId, "conversation-a");
  assert.equal(result.quoteRequestId, "quote-a");
  assert.equal(saved.length, 1);
});

test("SQLite StockCheck persists across restart and remains tenant-scoped", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atendente-stock-check-"));
  const path = join(directory, "inventory.db");
  try {
    let database = createSqliteDatabase({ filename: path });
    database.prepare("INSERT INTO automotive_businesses(id,name,business_type,timezone,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("business-a", "A", "WORKSHOP", "UTC", 1, "2026-01-01", "2026-01-01");
    database.prepare("INSERT INTO conversations(id,business_id,channel,status,started_at,last_message_at) VALUES(?,?,?,?,?,?)").run("conversation-a", "business-a", "WEB", "ACTIVE", "2026-01-01", "2026-01-01");
    database.prepare("INSERT INTO opportunities(id,business_id,conversation_id,request_description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("opportunity-a", "business-a", "conversation-a", "Freios", "WAITING_BUSINESS", "2026-01-01", "2026-01-01");
    database.prepare("INSERT INTO quote_requests(id,business_id,opportunity_id,conversation_id,request_description,status,requested_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("quote-a", "business-a", "opportunity-a", "conversation-a", "Freios", "REQUESTED", "2026-01-01", "2026-01-01", "2026-01-01");
    const repository = new SqliteStockCheckRepository(database);
    await repository.save({ id: "stock-a", businessId: "business-a", conversationId: "conversation-a", quoteRequestId: "quote-a", requestedItem: "Freios", inventoryReference: "sku-a", availability: InventoryAvailability.AVAILABLE, availableQuantity: 3, unit: "unidade", source: "fixture", checkedAt: "2026-01-01T10:00:00.000Z" });
    database.close();
    database = createSqliteDatabase({ filename: path });
    const restarted = new SqliteStockCheckRepository(database);
    const check = await restarted.findLatestByQuoteRequest("business-a", "quote-a");
    assert.equal(check?.availability, InventoryAvailability.AVAILABLE);
    assert.equal(check?.availableQuantity, 3);
    assert.equal((await restarted.listByBusiness("other-business")).length, 0);
    database.close();
  } finally {
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* SQLite may release the Windows handle after the test turn. */ }
  }
});
