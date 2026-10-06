import type { Money } from "./domain/types.js";

export type ProductIdentity = { inventoryReference?: string; externalItemId?: string; sku?: string };
export type ProductPriceReadInput = { businessId: string; identity: ProductIdentity };
export type ProductPriceReadResult =
  | { status: "AVAILABLE"; price: Money; source: string; checkedAt: string }
  | { status: "PRICE_UNAVAILABLE" | "IDENTITY_AMBIGUOUS"; source?: string; checkedAt?: string; reason?: string };
export interface ProductPriceReadPort { read(input: ProductPriceReadInput): Promise<ProductPriceReadResult>; }
export function productIdentityReference(identity: ProductIdentity): string | undefined {
  return identity.externalItemId?.trim() || identity.sku?.trim() || identity.inventoryReference?.trim() || undefined;
}
