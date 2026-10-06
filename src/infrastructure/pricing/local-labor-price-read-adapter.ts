import type { LaborPriceReadInput, LaborPriceReadPort, LaborPriceReadResult } from "../../core/labor-price-read-port.js";

export type LocalLaborPriceFixture = { businessId: string; description?: string; serviceReference?: string; priceCents: number; checkedAt?: string };

export class LocalLaborPriceReadAdapter implements LaborPriceReadPort {
  constructor(private readonly fixtures: LocalLaborPriceFixture[]) {}
  async read(input: LaborPriceReadInput): Promise<LaborPriceReadResult> {
    const description = input.description.trim().toLowerCase();
    const reference = input.serviceReference?.trim().toLowerCase();
    const fixture = this.fixtures.find((candidate) => candidate.businessId === input.businessId &&
      (reference !== undefined && candidate.serviceReference?.trim().toLowerCase() === reference || reference === undefined && candidate.description?.trim().toLowerCase() === description));
    if (!fixture || !Number.isSafeInteger(fixture.priceCents) || fixture.priceCents < 0) return { status: "PRICE_UNAVAILABLE", source: "local-fixture", reason: "No local preview labor price configured" };
    return { status: "AVAILABLE", price: { amountCents: fixture.priceCents, currency: "BRL" }, source: "local-fixture", checkedAt: fixture.checkedAt ?? new Date().toISOString() };
  }
}

export class UnavailableLaborPriceReadAdapter implements LaborPriceReadPort {
  async read(): Promise<LaborPriceReadResult> { return { status: "PRICE_UNAVAILABLE", source: "provider-unavailable", reason: "No productive labor price provider is configured" }; }
}
