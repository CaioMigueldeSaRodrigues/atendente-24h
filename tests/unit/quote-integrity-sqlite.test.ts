import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewAdminDependencies } from "../../src/app/admin-preview-fixture.js";
import { SqliteQuoteDraftRepository } from "../../src/infrastructure/sqlite/sqlite-quote-draft-repository.js";
import { SqliteQuoteRequestRepository } from "../../src/infrastructure/sqlite/sqlite-quote-request-repository.js";
import { SqliteOpportunityRepository } from "../../src/infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteStockCheckRepository } from "../../src/infrastructure/sqlite/sqlite-stock-check-repository.js";
import { withSqliteTransaction } from "../../src/infrastructure/sqlite/sqlite-connection-lock.js";
import { LocalInventoryReadAdapter } from "../../src/infrastructure/inventory/local-inventory-read-adapter.js";
import { LocalProductPriceReadAdapter } from "../../src/infrastructure/pricing/local-product-price-read-adapter.js";
import { LocalLaborPriceReadAdapter } from "../../src/infrastructure/pricing/local-labor-price-read-adapter.js";
import { buildQuoteDraft, QuoteDraftError, type BuildQuoteDraftDependencies } from "../../src/core/build-quote-draft.js";
import { authorizeQuoteDraft } from "../../src/core/authorize-quote-draft.js";
import { InventoryAvailability, QuoteRequestStatus } from "../../src/core/domain/enums.js";
import type { QuoteDraftRepository } from "../../src/core/repositories.js";

const businessId = "preview-intermediate-business";
const quoteRequestId = `${businessId}-quote-waiting`;
const now = () => "2026-09-29T10:30:00.000Z";
const input = () => ({ businessId, quoteRequestId, products: [{ requestedItem: "Óleo 5W30", sku: "OIL-5W30", quantity: 4, quantitySource: "OPERATOR_CONFIRMED" as const }], labor: [{ description: "Troca de óleo", quantity: 1, quantitySource: "OPERATOR_CONFIRMED" as const }] });

function fixture() {
  const preview = createPreviewAdminDependencies();
  const database = preview.database;
  const drafts = new SqliteQuoteDraftRepository(database);
  const quotes = new SqliteQuoteRequestRepository(database);
  const opportunities = new SqliteOpportunityRepository(database);
  let sequence = 0;
  const transaction = { run: <T>(_businessId: string, _quoteRequestId: string, operation: () => Promise<T>) => withSqliteTransaction(database, operation) };
  const dependencies: BuildQuoteDraftDependencies = {
    quoteRequestRepository: quotes, stockCheckRepository: new SqliteStockCheckRepository(database), quoteDraftRepository: drafts,
    quoteTransaction: transaction,
    inventoryReadPort: new LocalInventoryReadAdapter([{ requestedItem: "Óleo 5W30", sku: "OIL-5W30", availability: InventoryAvailability.AVAILABLE, availableQuantity: 4, unit: "L" }]),
    productPriceReadPort: new LocalProductPriceReadAdapter([{ businessId, identity: { sku: "OIL-5W30" }, priceCents: 4800 }]),
    laborPriceReadPort: new LocalLaborPriceReadAdapter([{ businessId, description: "Troca de óleo", priceCents: 9000 }]),
    now, generateId: (prefix) => `${prefix}-integrity-${++sequence}`,
  };
  return { database, drafts, quotes, opportunities, transaction, dependencies };
}

test("integrated authorization rolls back quote and opportunity when draft approval fails", async () => {
  const h = fixture();
  try {
    const draft = await buildQuoteDraft(input(), h.dependencies);
    const failingDrafts: QuoteDraftRepository = {
      findById: (business, id) => h.drafts.findById(business, id),
      findLatestByQuoteRequest: (business, quote) => h.drafts.findLatestByQuoteRequest(business, quote),
      save: (value) => h.drafts.save(value),
      approve: async () => { throw new Error("simulated draft persistence failure"); },
      markPublished: (business, id, at) => h.drafts.markPublished(business, id, at),
    };
    await assert.rejects(authorizeQuoteDraft({ businessId, quoteRequestId }, { quoteDraftRepository: failingDrafts, quoteTransaction: h.transaction, quoteRequestRepository: h.quotes, opportunityRepository: h.opportunities, now }), /simulated draft persistence failure/);
    assert.equal((await h.quotes.findById(businessId, quoteRequestId))?.status, QuoteRequestStatus.WAITING_BUSINESS);
    assert.equal((await h.quotes.findById(businessId, quoteRequestId))?.authorizedPrice, undefined);
    assert.equal((await h.opportunities.findById(businessId, `${businessId}-opportunity-waiting`))?.status, "WAITING_BUSINESS");
    assert.equal((await h.drafts.findById(businessId, draft.id))?.status, "PENDING_APPROVAL");
  } finally { h.database.close(); }
});

test("SQLite serializes concurrent revisions and enforces their unique constraint", async () => {
  const h = fixture();
  try {
    const results = await Promise.allSettled([buildQuoteDraft(input(), h.dependencies), buildQuoteDraft(input(), h.dependencies)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof QuoteDraftError && result.reason.code === "QUOTE_DRAFT_CONFLICT").length, 1);
    const first = (await h.drafts.findLatestByQuoteRequest(businessId, quoteRequestId))!;
    await assert.rejects(h.drafts.save({ ...first, id: "duplicate-revision", lines: first.lines.map((line) => ({ ...line, id: `${line.id}-duplicate`, quoteDraftId: "duplicate-revision" })) }), /UNIQUE constraint failed/);
    assert.equal((await h.drafts.findLatestByQuoteRequest(businessId, quoteRequestId))?.revision, 1);
  } finally { h.database.close(); }
});

test("SQLite refuses mutations of approved and published snapshots", async () => {
  const h = fixture();
  try {
    const draft = await buildQuoteDraft(input(), h.dependencies);
    const approved = await authorizeQuoteDraft({ businessId, quoteRequestId }, { quoteDraftRepository: h.drafts, quoteTransaction: h.transaction, quoteRequestRepository: h.quotes, opportunityRepository: h.opportunities, now });
    assert.equal(approved.status, "APPROVED");
    await assert.rejects(h.drafts.save({ ...approved, lines: approved.lines.map((line) => ({ ...line, quantity: 9 })) }), (error: unknown) => error instanceof QuoteDraftError && error.code === "DRAFT_IMMUTABLE");
    await h.drafts.markPublished(businessId, draft.id, now());
    const published = (await h.drafts.findById(businessId, draft.id))!;
    await assert.rejects(h.drafts.save({ ...published, total: { amountCents: 1, currency: "BRL" } }), (error: unknown) => error instanceof QuoteDraftError && error.code === "DRAFT_IMMUTABLE");
    assert.equal((await h.drafts.findById(businessId, draft.id))?.total.amountCents, 28200);
  } finally { h.database.close(); }
});
