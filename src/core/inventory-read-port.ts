import type { Vehicle } from "./domain/entities.js";
import type { InventoryAvailability } from "./domain/enums.js";

export type InventoryReadInput = {
  businessId: string;
  requestedItem: string;
  vehicle?: Pick<Vehicle, "brand" | "model" | "year" | "version">;
};

export type InventoryReadResult = {
  availability: InventoryAvailability;
  externalItemId?: string;
  sku?: string;
  description?: string;
  availableQuantity?: number;
  unit?: string;
  source?: string;
  checkedAt?: string;
};

export interface InventoryReadPort {
  check(input: InventoryReadInput): Promise<InventoryReadResult>;
}
