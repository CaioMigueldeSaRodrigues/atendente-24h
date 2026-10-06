import type { Money } from "./domain/types.js";

export type LaborPriceReadInput = { businessId: string; description: string; serviceReference?: string };
export type LaborPriceReadResult =
  | { status: "AVAILABLE"; price: Money; source: string; checkedAt: string }
  | { status: "PRICE_UNAVAILABLE"; source?: string; checkedAt?: string; reason?: string };
export interface LaborPriceReadPort { read(input: LaborPriceReadInput): Promise<LaborPriceReadResult>; }
