import test from "node:test";
import assert from "node:assert/strict";
import { AdminPlan } from "../../src/core/admin-plan-entitlement.js";
import { StaticBusinessCapabilityPolicy } from "../../src/core/business-capability-policy.js";
import { authorizeQuoteDraft } from "../../src/core/authorize-quote-draft.js";
import { buildQuoteDraft, QuoteDraftError, type BuildQuoteDraftDependencies } from "../../src/core/build-quote-draft.js";
import { InMemoryCommercialEventRepository, InMemoryOpportunityRepository, InMemoryQuoteDraftRepository, InMemoryQuoteRequestRepository } from "../../src/core/in-memory-repositories.js";
import type { StockCheck } from "../../src/core/domain/entities.js";
import type { StockCheckRepository } from "../../src/core/repositories.js";
import { OpportunityStatus, QuoteRequestStatus, InventoryAvailability } from "../../src/core/domain/enums.js";
import { LocalLaborPriceReadAdapter, UnavailableLaborPriceReadAdapter } from "../../src/infrastructure/pricing/local-labor-price-read-adapter.js";
import { LocalProductPriceReadAdapter, UnavailableProductPriceReadAdapter } from "../../src/infrastructure/pricing/local-product-price-read-adapter.js";
import type { InventoryReadPort } from "../../src/core/inventory-read-port.js";
import type { ProductPriceReadPort } from "../../src/core/product-price-read-port.js";
import type { LaborPriceReadPort } from "../../src/core/labor-price-read-port.js";

class MemoryStockChecks implements StockCheckRepository {
  readonly values: StockCheck[] = [];
  async save(entity: StockCheck): Promise<void> { this.values.push(entity); }
  async findLatestByQuoteRequest(businessId: string, quoteRequestId: string): Promise<StockCheck | null> { return [...this.values].reverse().find((value) => value.businessId === businessId && value.quoteRequestId === quoteRequestId) ?? null; }
  async listByBusiness(businessId: string): Promise<StockCheck[]> { return this.values.filter((value) => value.businessId === businessId); }
}

function harness() {
  const quoteRequests = new InMemoryQuoteRequestRepository();
  const opportunities = new InMemoryOpportunityRepository();
  const drafts = new InMemoryQuoteDraftRepository();
  const stockChecks = new MemoryStockChecks();
  const quote = { id: "quote-a", businessId: "business-a", opportunityId: "opportunity-a", conversationId: "conversation-a", requestDescription: "Troca de óleo", status: QuoteRequestStatus.WAITING_BUSINESS, requestedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  quoteRequests.save(quote);
  opportunities.save({ id: "opportunity-a", businessId: "business-a", conversationId: "conversation-a", status: OpportunityStatus.WAITING_BUSINESS, nextAction: { type: "PROVIDE_QUOTE", description: "Aguardar orçamento" }, createdAt: quote.createdAt, updatedAt: quote.updatedAt });
  let sequence = 0;
  const inventoryReadPort: InventoryReadPort = { check: async () => ({ availability: InventoryAvailability.AVAILABLE, externalItemId: "oil-5w30", description: "Óleo 5W30", source: "local-fixture", checkedAt: "2026-01-01T10:00:00.000Z" }) };
  const dependencies: BuildQuoteDraftDependencies = { quoteRequestRepository: quoteRequests, stockCheckRepository: stockChecks, inventoryReadPort, productPriceReadPort: new LocalProductPriceReadAdapter([{ businessId: "business-a", identity: { externalItemId: "oil-5w30" }, priceCents: 4800, checkedAt: "2026-01-01T10:00:00.000Z" }]), laborPriceReadPort: new LocalLaborPriceReadAdapter([{ businessId: "business-a", description: "Troca de óleo", priceCents: 9000, checkedAt: "2026-01-01T10:00:00.000Z" }]), quoteDraftRepository: drafts, quoteTransaction: { run: async (_businessId, _quoteRequestId, operation) => operation() }, now: () => "2026-01-01T10:00:00.000Z", generateId: (prefix: string) => `${prefix}-${++sequence}` };
  return { quoteRequests, opportunities, drafts, stockChecks, inventoryReadPort, dependencies };
}

function input() { return { businessId: "business-a", quoteRequestId: "quote-a", products: [{ requestedItem: "Óleo 5W30", externalItemId: "oil-5w30", quantity: 4, quantitySource: "OPERATOR_CONFIRMED" as const }], labor: [{ description: "Troca de óleo", quantity: 1, quantitySource: "OPERATOR_CONFIRMED" as const }] }; }

test("capability separates plan entitlement, business opt-in, and provider availability", async () => {
  const enabledSettings = { inventoryForAssistantEnabled: true, productPricingForAssistantEnabled: true, laborPricingForAssistantEnabled: true };
  const availableProviders = { inventory: true, productPricing: true, laborPricing: true };
  assert.equal((await new StaticBusinessCapabilityPolicy(AdminPlan.BASIC, enabledSettings, availableProviders).getCapabilities("business-a")).canBuildIntegratedQuote, false);
  assert.equal((await new StaticBusinessCapabilityPolicy(AdminPlan.INTERMEDIATE).getCapabilities("business-a")).canBuildIntegratedQuote, false);
  assert.equal((await new StaticBusinessCapabilityPolicy(AdminPlan.INTERMEDIATE, enabledSettings, availableProviders).getCapabilities("business-a")).canBuildIntegratedQuote, true);
  assert.equal((await new StaticBusinessCapabilityPolicy(AdminPlan.ADVANCED, enabledSettings, availableProviders).getCapabilities("business-a")).canBuildIntegratedQuote, true);
  const stockOnly = await new StaticBusinessCapabilityPolicy(AdminPlan.INTERMEDIATE, { inventoryForAssistantEnabled: true }, availableProviders).getCapabilities("business-a");
  assert.equal(stockOnly.capabilities.canUseInventoryInAssistant, true);
  assert.equal(stockOnly.capabilities.canUseProductPricingInAssistant, false);
  assert.equal(stockOnly.capabilities.canUseLaborPricingInAssistant, false);
  const unavailable = await new StaticBusinessCapabilityPolicy(AdminPlan.INTERMEDIATE, enabledSettings).getCapabilities("business-a");
  assert.deepEqual(unavailable.providerAvailability, { inventory: "PROVIDER_UNAVAILABLE", productPricing: "PROVIDER_UNAVAILABLE", laborPricing: "PROVIDER_UNAVAILABLE" });
  assert.equal(unavailable.settings.inventoryForAssistantEnabled, true);
  assert.equal(unavailable.capabilities.canUseInventoryInAssistant, false);
  assert.equal((await new StaticBusinessCapabilityPolicy(null, enabledSettings, availableProviders).getCapabilities("business-a")).canBuildIntegratedQuote, false);
});

test("pricing is deterministic and keeps product and labor subtotals", async () => {
  const h = harness();
  const draft = await buildQuoteDraft(input(), h.dependencies);
  assert.equal(draft.productsSubtotal.amountCents, 19200);
  assert.equal(draft.laborSubtotal.amountCents, 9000);
  assert.equal(draft.total.amountCents, 28200);
  assert.deepEqual(draft.lines.map((line) => line.kind), ["PRODUCT", "LABOR"]);
  assert.deepEqual(draft.lines.map((line) => line.quantitySource), ["OPERATOR_CONFIRMED", "OPERATOR_CONFIRMED"]);
  assert.equal(h.stockChecks.values.length, 1);
});

test("supports multiple product and labor lines without letting the LLM supply money", async () => {
  const h = harness();
  const draft = await buildQuoteDraft({ ...input(), products: [{ requestedItem: "Óleo 5W30", externalItemId: "oil-5w30", quantity: 2, quantitySource: "OPERATOR_CONFIRMED" }, { requestedItem: "Óleo 5W30", externalItemId: "oil-5w30", quantity: 1, quantitySource: "OPERATOR_CONFIRMED" }], labor: [{ description: "Troca de óleo", quantity: 1, quantitySource: "OPERATOR_CONFIRMED" }, { description: "Troca de óleo", quantity: 2, quantitySource: "OPERATOR_CONFIRMED" }] }, h.dependencies);
  assert.equal(draft.lines.filter((line) => line.kind === "PRODUCT").length, 2);
  assert.equal(draft.lines.filter((line) => line.kind === "LABOR").length, 2);
  assert.equal(draft.total.amountCents, 41400);
});

test("snapshot does not change when external price changes and a new revision supersedes the previous one", async () => {
  const h = harness();
  const first = await buildQuoteDraft(input(), h.dependencies);
  const before = await h.drafts.findById("business-a", first.id);
  assert.equal(before?.total.amountCents, 28200);
  h.dependencies.productPriceReadPort = new LocalProductPriceReadAdapter([{ businessId: "business-a", identity: { externalItemId: "oil-5w30" }, priceCents: 5500 }]);
  const second = await buildQuoteDraft(input(), h.dependencies);
  assert.equal(second.revision, 2);
  assert.equal(second.total.amountCents, 31000);
  assert.equal((await h.drafts.findById("business-a", first.id))?.status, "SUPERSEDED");
  assert.equal((await h.drafts.findById("business-a", first.id))?.total.amountCents, 28200);
});

test("approved draft is immutable and authorize writes the QuoteRequest total", async () => {
  const h = harness();
  const draft = await buildQuoteDraft(input(), h.dependencies);
  const approved = await authorizeQuoteDraft({ businessId: "business-a", quoteRequestId: "quote-a", expectedDraftId: draft.id, expectedRevision: draft.revision }, { quoteDraftRepository: h.drafts, quoteTransaction: h.dependencies.quoteTransaction, quoteRequestRepository: h.quoteRequests, opportunityRepository: h.opportunities, commercialEventRepository: new InMemoryCommercialEventRepository(), now: h.dependencies.now, generateId: h.dependencies.generateId });
  assert.equal(approved.status, "APPROVED");
  assert.equal((await h.quoteRequests.findById("business-a", "quote-a"))?.authorizedPrice?.amountCents, draft.total.amountCents);
  await assert.rejects(buildQuoteDraft(input(), h.dependencies), (error: unknown) => error instanceof QuoteDraftError && error.code === "DRAFT_IMMUTABLE");
});

test("missing identity and unavailable price never invent a price", async () => {
  const h = harness();
  h.dependencies.inventoryReadPort = { check: async () => ({ availability: InventoryAvailability.AVAILABLE, description: "Óleo ambíguo" }) };
  await assert.rejects(buildQuoteDraft({ ...input(), products: [{ requestedItem: "Óleo", quantity: 1, quantitySource: "OPERATOR_CONFIRMED" }] }, h.dependencies), (error: unknown) => error instanceof QuoteDraftError && error.code === "PRODUCT_IDENTITY_UNAVAILABLE");
  h.dependencies.inventoryReadPort = h.inventoryReadPort;
  h.dependencies.productPriceReadPort = new UnavailableProductPriceReadAdapter();
  await assert.rejects(buildQuoteDraft(input(), h.dependencies), (error: unknown) => error instanceof QuoteDraftError && error.code === "PRICE_UNAVAILABLE");
  const labor = new UnavailableLaborPriceReadAdapter();
  h.dependencies.productPriceReadPort = new LocalProductPriceReadAdapter([{ businessId: "business-a", identity: { externalItemId: "oil-5w30" }, priceCents: 4800 }]);
  h.dependencies.laborPriceReadPort = labor;
  await assert.rejects(buildQuoteDraft(input(), h.dependencies), (error: unknown) => error instanceof QuoteDraftError && error.code === "PRICE_UNAVAILABLE");
});

test("draft repository isolates businesses", async () => {
  const h = harness();
  const draft = await buildQuoteDraft(input(), h.dependencies);
  assert.equal(await h.drafts.findById("business-b", draft.id), null);
  assert.equal((await h.drafts.findLatestByQuoteRequest("business-a", "quote-a"))?.businessId, "business-a");
});

test("product price receives only the inventory-confirmed identity and rejects mismatched hints", async () => {
  const h = harness();
  const seen: unknown[] = [];
  h.dependencies.productPriceReadPort = { read: async (value) => { seen.push(value.identity); return { status: "AVAILABLE", price: { amountCents: 4800, currency: "BRL" }, source: "test", checkedAt: h.dependencies.now() }; } };
  await buildQuoteDraft(input(), h.dependencies);
  assert.deepEqual(seen, [{ externalItemId: "oil-5w30" }]);
  await assert.rejects(buildQuoteDraft({ ...input(), products: [{ ...input().products[0]!, externalItemId: "other-item" }] }, h.dependencies), (error: unknown) => error instanceof QuoteDraftError && error.code === "IDENTITY_AMBIGUOUS");
  assert.equal(seen.length, 1);
});

test("typed product references cannot be swapped between SKU and external id", async () => {
  const h = harness();
  h.dependencies.inventoryReadPort = { check: async () => ({ availability: InventoryAvailability.AVAILABLE, sku: "sku-from-stock", externalItemId: "id-from-stock" }) };
  await assert.rejects(buildQuoteDraft({ ...input(), products: [{ ...input().products[0]!, sku: "id-from-stock", externalItemId: "sku-from-stock" }] }, h.dependencies), (error: unknown) => error instanceof QuoteDraftError && error.code === "IDENTITY_AMBIGUOUS");
});

test("quantity source is required, trusted and separate from arithmetic", async () => {
  const h = harness();
  const original = input();
  for (const quantitySource of [undefined, "LLM_INFERRED"] as const) {
    await assert.rejects(buildQuoteDraft({ ...original, products: [{ ...original.products[0]!, quantitySource: quantitySource as "OPERATOR_CONFIRMED" }] }, h.dependencies), (error: unknown) => error instanceof QuoteDraftError && error.code === "INVALID_QUANTITY");
  }
  const accepted = await buildQuoteDraft({ ...original, products: [{ ...original.products[0]!, quantitySource: "WORKSHOP_SYSTEM" }] }, h.dependencies);
  assert.equal(accepted.total.amountCents, 28200);
});

test("concurrent draft requests cannot persist the same revision", async () => {
  const h = harness();
  const results = await Promise.allSettled([buildQuoteDraft(input(), h.dependencies), buildQuoteDraft(input(), h.dependencies)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof QuoteDraftError && result.reason.code === "QUOTE_DRAFT_CONFLICT").length, 1);
  assert.equal((await h.drafts.findLatestByQuoteRequest("business-a", "quote-a"))?.revision, 1);
});

test("in-memory repository does not overwrite approved or published snapshots", async () => {
  const h = harness();
  const draft = await buildQuoteDraft(input(), h.dependencies);
  await h.drafts.approve("business-a", draft.id, h.dependencies.now());
  const approved = (await h.drafts.findById("business-a", draft.id))!;
  await assert.rejects(h.drafts.save({ ...approved, total: { amountCents: 1, currency: "BRL" } }), (error: unknown) => error instanceof QuoteDraftError && error.code === "DRAFT_IMMUTABLE");
  await h.drafts.markPublished("business-a", draft.id, h.dependencies.now());
  const published = (await h.drafts.findById("business-a", draft.id))!;
  await assert.rejects(h.drafts.save({ ...published, lines: [] }), (error: unknown) => error instanceof QuoteDraftError && error.code === "DRAFT_IMMUTABLE");
  assert.equal((await h.drafts.findById("business-a", draft.id))?.status, "PUBLISHED");
});
