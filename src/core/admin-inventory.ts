import type { AdminPeriod } from "./admin-read-model.js";
import type { InventoryAvailability } from "./domain/enums.js";
import type { StockCheck } from "./domain/entities.js";

export type AdminInventoryFilters = {
  businessId: string;
  period?: AdminPeriod;
  availability?: InventoryAvailability;
  requestedItem?: string;
};

export type AdminInventoryCheck = Pick<StockCheck,
  "id" | "conversationId" | "quoteRequestId" | "vehicleId" | "requestedItem" |
  "inventoryReference" | "availability" | "availableQuantity" | "unit" | "source" | "checkedAt"
>;

export type AdminInventoryItem = {
  requestedItem: string;
  queries: number;
  available: number;
  lowStock: number;
  outOfStock: number;
  unknown: number;
  withoutAvailability: number;
};

export type AdminInventory = {
  businessId: string;
  period: AdminPeriod;
  summary: {
    total: number;
    available: number;
    lowStock: number;
    outOfStock: number;
    unknown: number;
    withoutAvailability: number;
  };
  items: AdminInventoryItem[];
  checks: AdminInventoryCheck[];
};

function normalizedItem(value: string): { key: string; label: string } {
  const label = value.trim().replace(/\s+/g, " ");
  return { key: label.toLocaleLowerCase("pt-BR"), label };
}

export function buildAdminInventory(input: AdminInventoryFilters, rows: readonly StockCheck[]): AdminInventory {
  const summary = { total: rows.length, available: 0, lowStock: 0, outOfStock: 0, unknown: 0, withoutAvailability: 0 };
  const itemMap = new Map<string, AdminInventoryItem & { label: string }>();

  for (const row of rows) {
    if (row.availability === "AVAILABLE") summary.available += 1;
    else if (row.availability === "LOW_STOCK") summary.lowStock += 1;
    else if (row.availability === "OUT_OF_STOCK") summary.outOfStock += 1;
    else summary.unknown += 1;
    if (row.availability === "OUT_OF_STOCK" || row.availability === "UNKNOWN") summary.withoutAvailability += 1;

    const normalized = normalizedItem(row.requestedItem);
    const current = itemMap.get(normalized.key) ?? {
      label: normalized.label, requestedItem: normalized.label, queries: 0, available: 0, lowStock: 0,
      outOfStock: 0, unknown: 0, withoutAvailability: 0,
    };
    current.queries += 1;
    if (row.availability === "AVAILABLE") current.available += 1;
    else if (row.availability === "LOW_STOCK") current.lowStock += 1;
    else if (row.availability === "OUT_OF_STOCK") current.outOfStock += 1;
    else current.unknown += 1;
    if (row.availability === "OUT_OF_STOCK" || row.availability === "UNKNOWN") current.withoutAvailability += 1;
    itemMap.set(normalized.key, current);
  }

  return {
    businessId: input.businessId,
    period: input.period ?? {},
    summary,
    items: [...itemMap.values()]
      .sort((left, right) => right.queries - left.queries || left.label.localeCompare(right.label, "pt-BR"))
      .map(({ label: _label, ...item }) => item),
    checks: rows.map(({ businessId: _businessId, ...row }) => row),
  };
}
