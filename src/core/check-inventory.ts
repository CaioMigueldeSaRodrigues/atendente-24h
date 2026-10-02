import { randomUUID } from "node:crypto";
import type { StockCheck, Vehicle } from "./domain/entities.js";
import { InventoryAvailability } from "./domain/enums.js";
import type { StockCheckRepository } from "./repositories.js";
import type { InventoryReadPort } from "./inventory-read-port.js";

export type CheckInventoryInput = {
  businessId: string;
  conversationId: string;
  quoteRequestId: string;
  vehicleId?: string;
  requestedItem: string;
  vehicle?: Pick<Vehicle, "brand" | "model" | "year" | "version">;
};

export async function checkInventory(
  input: CheckInventoryInput,
  port: InventoryReadPort,
  repository: StockCheckRepository,
  options: { now?: () => string; generateId?: () => string } = {},
): Promise<StockCheck> {
  const now = options.now ?? (() => new Date().toISOString());
  let result;
  try {
    result = await port.check({ businessId: input.businessId, requestedItem: input.requestedItem, ...(input.vehicle ? { vehicle: input.vehicle } : {}) });
  } catch {
    result = { availability: InventoryAvailability.UNKNOWN, source: "provider-error" };
  }
  const checkedAt = result.checkedAt ?? now();
  const check: StockCheck = {
    id: (options.generateId ?? (() => `stock-check-${randomUUID()}`))(),
    businessId: input.businessId,
    conversationId: input.conversationId,
    quoteRequestId: input.quoteRequestId,
    ...(input.vehicleId === undefined ? {} : { vehicleId: input.vehicleId }),
    requestedItem: input.requestedItem,
    inventoryReference: result.externalItemId ?? result.sku ?? result.description ?? input.requestedItem,
    availability: result.availability,
    ...(result.availableQuantity === undefined ? {} : { availableQuantity: result.availableQuantity }),
    ...(result.unit === undefined ? {} : { unit: result.unit }),
    source: result.source ?? "unknown",
    checkedAt,
  };
  await repository.save(check);
  return check;
}
