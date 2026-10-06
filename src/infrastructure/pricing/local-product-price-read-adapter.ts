import type { ProductIdentity, ProductPriceReadInput, ProductPriceReadPort, ProductPriceReadResult } from "../../core/product-price-read-port.js";

export type LocalProductPriceFixture = { businessId: string; identity: ProductIdentity; priceCents: number; checkedAt?: string };

export class LocalProductPriceReadAdapter implements ProductPriceReadPort {
  private readonly fixtures: LocalProductPriceFixture[];
  constructor(fixtures: LocalProductPriceFixture[]) { this.fixtures = fixtures; }
  async read(input: ProductPriceReadInput): Promise<ProductPriceReadResult> {
    const key = identityKey(input.identity);
    if (!key) return { status: "IDENTITY_AMBIGUOUS", source: "local-fixture", reason: "Product identity is required" };
    const fixture = this.fixtures.find((candidate) => candidate.businessId === input.businessId && identityKey(candidate.identity) === key);
    if (!fixture || !Number.isSafeInteger(fixture.priceCents) || fixture.priceCents < 0) return { status: "PRICE_UNAVAILABLE", source: "local-fixture", reason: "No local preview price configured" };
    return { status: "AVAILABLE", price: { amountCents: fixture.priceCents, currency: "BRL" }, source: "local-fixture", checkedAt: fixture.checkedAt ?? new Date().toISOString() };
  }
}

export class UnavailableProductPriceReadAdapter implements ProductPriceReadPort {
  async read(): Promise<ProductPriceReadResult> { return { status: "PRICE_UNAVAILABLE", source: "provider-unavailable", reason: "No productive product price provider is configured" }; }
}

function identityKey(identity: ProductIdentity): string | undefined {
  const value = identity.externalItemId?.trim() || identity.sku?.trim() || identity.inventoryReference?.trim();
  return value ? value.toLowerCase() : undefined;
}
