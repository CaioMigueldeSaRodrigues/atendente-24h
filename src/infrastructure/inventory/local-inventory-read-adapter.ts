import type { InventoryReadInput, InventoryReadPort, InventoryReadResult } from "../../core/inventory-read-port.js";
import { InventoryAvailability } from "../../core/domain/enums.js";

export type LocalInventoryFixture = InventoryReadResult & { requestedItem: string };

function key(value: string): string { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR"); }

export class LocalInventoryReadAdapter implements InventoryReadPort {
  private readonly fixtures: Map<string, InventoryReadResult>;
  constructor(fixtures: readonly LocalInventoryFixture[] = []) {
    this.fixtures = new Map(fixtures.map(({ requestedItem, ...result }) => [key(requestedItem), result]));
  }
  async check(input: InventoryReadInput): Promise<InventoryReadResult> {
    return this.fixtures.get(key(input.requestedItem)) ?? { availability: InventoryAvailability.UNKNOWN, source: "local-fixture" };
  }
}

export class UnavailableInventoryReadAdapter implements InventoryReadPort {
  async check(_input: InventoryReadInput): Promise<InventoryReadResult> {
    return { availability: InventoryAvailability.UNKNOWN, source: "provider-unavailable" };
  }
}
