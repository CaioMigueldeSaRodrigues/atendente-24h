import { InventoryAvailability, QuoteDraftLineKind, QuoteRequestStatus } from "./domain/enums.js";
import type { QuoteRequest } from "./domain/entities.js";
import type { InventoryReadPort, InventoryReadResult } from "./inventory-read-port.js";
import type { QuotePersistenceTransaction } from "./quote-persistence-transaction.js";
import type { LaborPriceReadPort } from "./labor-price-read-port.js";
import type { ProductIdentity, ProductPriceReadPort } from "./product-price-read-port.js";
import type { QuoteRequestRepository, QuoteDraftRepository, StockCheckRepository } from "./repositories.js";
import { QuoteDraftStatus, type QuoteDraft, type QuoteDraftLine } from "./quote-draft.js";
import { QuotePricingEngine } from "./quote-pricing-engine.js";

export type QuantitySource = "OPERATOR_CONFIRMED" | "WORKSHOP_SYSTEM";
export type ProductDraftInput = { requestedItem: string; quantity: number; quantitySource: QuantitySource } & ProductIdentity;
export type LaborDraftInput = { description: string; quantity: number; quantitySource: QuantitySource; serviceReference?: string };
export type BuildQuoteDraftInput = { businessId: string; quoteRequestId: string; products: ProductDraftInput[]; labor: LaborDraftInput[] };

export class QuoteDraftError extends Error {
  constructor(public readonly code: "QUOTE_NOT_FOUND" | "PRICE_UNAVAILABLE" | "IDENTITY_AMBIGUOUS" | "PRODUCT_IDENTITY_UNAVAILABLE" | "PRODUCT_UNAVAILABLE" | "INVALID_QUANTITY" | "DRAFT_IMMUTABLE" | "DRAFT_NOT_APPROVABLE" | "QUOTE_DRAFT_CONFLICT" | "CAPABILITY_REQUIRED", message: string = code) {
    super(message);
  }
}

export type BuildQuoteDraftDependencies = {
  quoteRequestRepository: QuoteRequestRepository;
  stockCheckRepository: StockCheckRepository;
  inventoryReadPort: InventoryReadPort;
  productPriceReadPort: ProductPriceReadPort;
  laborPriceReadPort: LaborPriceReadPort;
  quoteDraftRepository: QuoteDraftRepository;
  quoteTransaction: QuotePersistenceTransaction;
  now: () => string;
  generateId: (prefix: string) => string;
};

export async function buildQuoteDraft(input: BuildQuoteDraftInput, dependencies: BuildQuoteDraftDependencies): Promise<QuoteDraft> {
  const quote = await dependencies.quoteRequestRepository.findById(input.businessId, input.quoteRequestId);
  if (!quote) throw new QuoteDraftError("QUOTE_NOT_FOUND", "QuoteRequest not found");
  if (input.products.length === 0 && input.labor.length === 0) throw new QuoteDraftError("INVALID_QUANTITY", "Quote draft needs at least one line");
  const previous = await dependencies.quoteDraftRepository.findLatestByQuoteRequest(input.businessId, input.quoteRequestId);
  if (previous?.status === QuoteDraftStatus.APPROVED || previous?.status === QuoteDraftStatus.PUBLISHED) throw new QuoteDraftError("DRAFT_IMMUTABLE", "Approved quote draft is immutable");
  if (quote.status !== QuoteRequestStatus.WAITING_BUSINESS) throw new QuoteDraftError("DRAFT_NOT_APPROVABLE", "QuoteRequest is no longer waiting for the business");

  const lines: QuoteDraftLine[] = [];
  for (const product of input.products) {
    validateQuantity(product.quantity, product.quantitySource);
    const { identity, stock } = await readProductIdentity(input.businessId, product, dependencies);
    const price = await dependencies.productPriceReadPort.read({ businessId: input.businessId, identity });
    if (price.status !== "AVAILABLE") throw new QuoteDraftError(price.status === "IDENTITY_AMBIGUOUS" ? "IDENTITY_AMBIGUOUS" : "PRICE_UNAVAILABLE", price.reason ?? price.status);
    const description = product.requestedItem.trim();
    const line: QuoteDraftLine = {
      id: dependencies.generateId("quote-draft-line"), businessId: input.businessId, quoteDraftId: "pending",
      kind: QuoteDraftLineKind.PRODUCT, description, ...(identity.inventoryReference || identity.externalItemId || identity.sku ? { externalReference: identity.inventoryReference || identity.externalItemId || identity.sku } : {}),
      quantity: product.quantity, unit: "UN", unitPriceCaptured: price.price,
      subtotal: { amountCents: product.quantity * price.price.amountCents, currency: "BRL" }, source: price.source, checkedAt: price.checkedAt,
    };
    await readAndSaveInventory(input.businessId, quote, product, identity, stock, dependencies);
    lines.push(line);
  }
  for (const labor of input.labor) {
    validateQuantity(labor.quantity, labor.quantitySource);
    const description = labor.description.trim();
    if (!description) throw new QuoteDraftError("PRICE_UNAVAILABLE", "Labor description is required");
    const price = await dependencies.laborPriceReadPort.read({ businessId: input.businessId, description, ...(labor.serviceReference?.trim() ? { serviceReference: labor.serviceReference.trim() } : {}) });
    if (price.status !== "AVAILABLE") throw new QuoteDraftError("PRICE_UNAVAILABLE", price.reason ?? price.status);
    lines.push({
      id: dependencies.generateId("quote-draft-line"), businessId: input.businessId, quoteDraftId: "pending", kind: QuoteDraftLineKind.LABOR, description,
      ...(labor.serviceReference?.trim() ? { externalReference: labor.serviceReference.trim() } : {}), quantity: labor.quantity, unit: "SERVICO",
      unitPriceCaptured: price.price, subtotal: { amountCents: labor.quantity * price.price.amountCents, currency: "BRL" }, source: price.source, checkedAt: price.checkedAt,
    });
  }
  const draftId = dependencies.generateId("quote-draft");
  const draftLines = lines.map((line) => ({ ...line, quoteDraftId: draftId }));
  const priced = new QuotePricingEngine().calculate(draftLines);
  const now = dependencies.now();
  const draft: QuoteDraft = {
    id: draftId, businessId: input.businessId, conversationId: quote.conversationId, quoteRequestId: quote.id,
    ...(quote.vehicleId === undefined ? {} : { vehicleId: quote.vehicleId }), revision: (previous?.revision ?? 0) + 1,
    status: QuoteDraftStatus.PENDING_APPROVAL, lines: priced.lines, productsSubtotal: priced.productsSubtotal, laborSubtotal: priced.laborSubtotal,
    total: priced.total, createdAt: now, updatedAt: now,
  };
  await dependencies.quoteTransaction.run(input.businessId, input.quoteRequestId, async () => {
    const current = await dependencies.quoteDraftRepository.findLatestByQuoteRequest(input.businessId, input.quoteRequestId);
    const currentQuote = await dependencies.quoteRequestRepository.findById(input.businessId, input.quoteRequestId);
    if (currentQuote?.status !== QuoteRequestStatus.WAITING_BUSINESS || current?.id !== previous?.id || current?.revision !== previous?.revision) {
      throw new QuoteDraftError("QUOTE_DRAFT_CONFLICT", "Quote draft changed while pricing");
    }
    if (current?.status === QuoteDraftStatus.APPROVED || current?.status === QuoteDraftStatus.PUBLISHED) throw new QuoteDraftError("DRAFT_IMMUTABLE");
    if (current) await dependencies.quoteDraftRepository.save({ ...current, status: QuoteDraftStatus.SUPERSEDED, updatedAt: now });
    await dependencies.quoteDraftRepository.save(draft);
  });
  return draft;
}

async function readProductIdentity(businessId: string, product: ProductDraftInput, dependencies: BuildQuoteDraftDependencies): Promise<{ identity: ProductIdentity; stock: InventoryReadResult }> {
  let result: InventoryReadResult;
  try { result = await dependencies.inventoryReadPort.check({ businessId, requestedItem: product.requestedItem }); }
  catch { throw new QuoteDraftError("IDENTITY_AMBIGUOUS", "Product identity could not be confirmed by inventory provider"); }
  if (result.availability !== InventoryAvailability.AVAILABLE && result.availability !== InventoryAvailability.LOW_STOCK) throw new QuoteDraftError("PRODUCT_UNAVAILABLE");
  if (result.availableQuantity !== undefined && result.availableQuantity < product.quantity) throw new QuoteDraftError("PRODUCT_UNAVAILABLE");
  const discovered = cleanIdentity({ ...(result.externalItemId ? { externalItemId: result.externalItemId } : {}), ...(result.sku ? { sku: result.sku } : {}) });
  if (!discovered) throw new QuoteDraftError("PRODUCT_IDENTITY_UNAVAILABLE");
  const expected = cleanIdentity(product);
  for (const value of Object.values(expected ?? {})) {
    if (!Object.values(discovered).some((actual) => actual.toLowerCase() === value.toLowerCase())) throw new QuoteDraftError("IDENTITY_AMBIGUOUS", "Requested product reference differs from inventory");
  }
  return { identity: discovered, stock: result };
}

async function readAndSaveInventory(businessId: string, quote: QuoteRequest, product: ProductDraftInput, identity: ProductIdentity, result: InventoryReadResult, dependencies: BuildQuoteDraftDependencies): Promise<void> {
  await dependencies.stockCheckRepository.save({
    id: dependencies.generateId("stock-check"), businessId, conversationId: quote.conversationId, quoteRequestId: quote.id,
    ...(quote.vehicleId === undefined ? {} : { vehicleId: quote.vehicleId }), requestedItem: product.requestedItem,
    inventoryReference: identity.externalItemId ?? identity.sku ?? identity.inventoryReference ?? result.description ?? product.requestedItem,
    availability: result.availability, ...(result.availableQuantity === undefined ? {} : { availableQuantity: result.availableQuantity }),
    ...(result.unit === undefined ? {} : { unit: result.unit }), source: result.source ?? "unknown", checkedAt: result.checkedAt ?? dependencies.now(),
  });
}

function cleanIdentity(value: ProductIdentity): ProductIdentity | undefined {
  const identity = { ...(value.inventoryReference?.trim() ? { inventoryReference: value.inventoryReference.trim() } : {}), ...(value.externalItemId?.trim() ? { externalItemId: value.externalItemId.trim() } : {}), ...(value.sku?.trim() ? { sku: value.sku.trim() } : {}) };
  return Object.keys(identity).length === 0 ? undefined : identity;
}
function validateQuantity(quantity: number, source: QuantitySource): void { if (!Number.isSafeInteger(quantity) || quantity <= 0 || (source !== "OPERATOR_CONFIRMED" && source !== "WORKSHOP_SYSTEM")) throw new QuoteDraftError("INVALID_QUANTITY", "Quantity must be a positive integer from a trusted source"); }
