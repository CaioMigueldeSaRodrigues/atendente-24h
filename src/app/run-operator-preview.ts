import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { InventoryAvailability, QuoteRequestStatus } from "../core/domain/enums.js";
import { MANAUS_COMMERCIAL_CLUSTERS, MANAUS_COMMERCIAL_REGIONS, MANAUS_MAPPED_BUSINESSES } from "./manaus-market-mapping.js";
import { renderAmpliviewAdminUi } from "../infrastructure/http/ampliview-admin-ui.js";
import { renderBasicPlanAuthUi } from "../infrastructure/http/basic-plan-auth-ui.js";
import { renderBasicPlanOperatorUi } from "../infrastructure/http/basic-plan-operator-ui.js";
import { handleAdminRequest } from "../infrastructure/http/basic-plan-http-server.js";
import { createPreviewAdminDependencies, PREVIEW_ADMIN_BUSINESS_ID } from "./admin-preview-fixture.js";
import { SqliteStockCheckRepository } from "../infrastructure/sqlite/sqlite-stock-check-repository.js";
import { SqliteQuoteRequestRepository } from "../infrastructure/sqlite/sqlite-quote-request-repository.js";
import { SqliteOpportunityRepository } from "../infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteQuoteDraftRepository } from "../infrastructure/sqlite/sqlite-quote-draft-repository.js";
import { SqliteBusinessPlanAssignmentRepository } from "../infrastructure/sqlite/sqlite-business-plan-assignment-repository.js";
import { SqliteCommercialEventRepository } from "../infrastructure/sqlite/sqlite-commercial-event-repository.js";
import { SqliteMessageRepository } from "../infrastructure/sqlite/sqlite-message-repository.js";
import { SqliteConversationRepository } from "../infrastructure/sqlite/sqlite-conversation-repository.js";
import { AssignmentBusinessCapabilityPolicy } from "../core/business-capability-policy.js";
import { authorizeQuoteDraft } from "../core/authorize-quote-draft.js";
import { buildQuoteDraft, QuoteDraftError, type LaborDraftInput, type ProductDraftInput } from "../core/build-quote-draft.js";
import { LocalInventoryReadAdapter } from "../infrastructure/inventory/local-inventory-read-adapter.js";
import { LocalProductPriceReadAdapter } from "../infrastructure/pricing/local-product-price-read-adapter.js";
import { LocalLaborPriceReadAdapter } from "../infrastructure/pricing/local-labor-price-read-adapter.js";
import { SqliteBusinessAssistantIntegrationSettingsRepository } from "../infrastructure/sqlite/sqlite-business-assistant-integration-settings-repository.js";
import { withSqliteTransaction } from "../infrastructure/sqlite/sqlite-connection-lock.js";

const HOST = "127.0.0.1";
const PORT = 3001;
const ADMIN_BUSINESS_ID = PREVIEW_ADMIN_BUSINESS_ID;
const OPERATOR_BUSINESS_ID = "preview-intermediate-business";
const BUSINESS_ID = ADMIN_BUSINESS_ID;
const OIL_REQUEST = "troca de óleo";
const OIL_PRODUCT = "Óleo 5W30";
const OIL_SKU = "OIL-5W30";
const MAX_BODY_BYTES = 1024 * 1024;

const previewAdmin = createPreviewAdminDependencies();
const previewStockCheckRepository = new SqliteStockCheckRepository(previewAdmin.database);
const previewQuoteRequestRepository = new SqliteQuoteRequestRepository(previewAdmin.database);
const previewOpportunityRepository = new SqliteOpportunityRepository(previewAdmin.database);
const previewQuoteDraftRepository = new SqliteQuoteDraftRepository(previewAdmin.database);
const previewCommercialEventRepository = new SqliteCommercialEventRepository(previewAdmin.database);
const previewMessageRepository = new SqliteMessageRepository(previewAdmin.database);
const previewConversationRepository = new SqliteConversationRepository(previewAdmin.database);
const previewCapabilityPolicy = new AssignmentBusinessCapabilityPolicy(new SqliteBusinessPlanAssignmentRepository(previewAdmin.database), new SqliteBusinessAssistantIntegrationSettingsRepository(previewAdmin.database), { inventory: true, productPricing: true, laborPricing: true });
const previewInventoryReadPort = new LocalInventoryReadAdapter([{
  requestedItem: OIL_PRODUCT,
  sku: OIL_SKU,
  externalItemId: OIL_SKU,
  description: "Óleo 5W30",
  availability: InventoryAvailability.AVAILABLE,
  availableQuantity: 4,
  unit: "L",
  source: "local-fixture",
  checkedAt: "2026-09-29T10:30:00.000Z",
}]);
const previewProductPriceReadPort = new LocalProductPriceReadAdapter([{
  businessId: OPERATOR_BUSINESS_ID,
  identity: { sku: OIL_SKU },
  priceCents: 4800,
  checkedAt: "2026-09-29T10:30:00.000Z",
}]);
const previewLaborPriceReadPort = new LocalLaborPriceReadAdapter([{
  businessId: OPERATOR_BUSINESS_ID,
  description: OIL_REQUEST,
  priceCents: 9000,
  checkedAt: "2026-09-29T10:30:00.000Z",
}]);

type PreviewQuoteItem = {
  quote: {
    id: string;
    businessId: string;
    opportunityId: string;
    conversationId: string;
    customerId: string;
    vehicleId: string;
    requestDescription: string;
    symptomDescription?: string;
    status: QuoteRequestStatus;
    requestedAt: string;
    createdAt: string;
    updatedAt: string;
    authorizedPrice?: { amountCents: number; currency: "BRL" };
  };
  customer: {
    id: string;
    businessId: string;
    name: string;
    primaryPhone?: string;
  };
  vehicle: {
    id: string;
    businessId: string;
    brand: string;
    model: string;
    year: number;
    version?: string;
  };
  conversation: {
    id: string;
    businessId: string;
    channel: "WEB" | "WHATSAPP";
  };
};

let items: PreviewQuoteItem[] = [{
  quote: {
    id: `${OPERATOR_BUSINESS_ID}-quote-waiting`, businessId: OPERATOR_BUSINESS_ID, opportunityId: `${OPERATOR_BUSINESS_ID}-opportunity-waiting`,
    conversationId: `${OPERATOR_BUSINESS_ID}-conversation-waiting`, customerId: `${OPERATOR_BUSINESS_ID}-customer-waiting`, vehicleId: `${OPERATOR_BUSINESS_ID}-vehicle-waiting`,
    requestDescription: "troca de óleo", status: QuoteRequestStatus.WAITING_BUSINESS,
    requestedAt: "2026-09-29T10:00:00.000Z", createdAt: "2026-09-29T10:00:00.000Z", updatedAt: "2026-09-29T10:05:00.000Z",
  },
  customer: { id: `${OPERATOR_BUSINESS_ID}-customer-waiting`, businessId: OPERATOR_BUSINESS_ID, name: "Ana Souza", primaryPhone: "5511999990001" },
  vehicle: { id: `${OPERATOR_BUSINESS_ID}-vehicle-waiting`, businessId: OPERATOR_BUSINESS_ID, brand: "Toyota", model: "Corolla", year: 2020, version: "XEi" },
  conversation: { id: `${OPERATOR_BUSINESS_ID}-conversation-waiting`, businessId: OPERATOR_BUSINESS_ID, channel: "WHATSAPP" },
}];
let previewSequence = 0;
const previewNow = () => "2026-09-29T10:30:00.000Z";
const previewGenerateId = (prefix: string) => `${prefix}-preview-${++previewSequence}`;

export const server = createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    sendJson(response, 500, { error: "Internal server error" });
  });
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? "/", `http://${HOST}:${PORT}`).pathname;
  if (request.method === "GET" && pathname === "/") {
    response.writeHead(302, { Location: "/login" });
    response.end();
    return;
  }
  if (request.method === "GET" && pathname === "/login") {
    sendHtml(response, renderBasicPlanAuthUi("login"));
    return;
  }
  if (request.method === "GET" && pathname === "/cadastro") {
    sendHtml(response, renderBasicPlanAuthUi("register"));
    return;
  }
  if (request.method === "GET" && pathname === "/admin/login") {
    sendHtml(response, renderBasicPlanAuthUi("admin-login"));
    return;
  }
  if (pathname.startsWith("/v1/admin/")) {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    await handleAdminRequest(url, request, response, previewAdmin);
    return;
  }
  if (request.method === "GET" && pathname === "/admin") {
    sendHtml(response, renderAmpliviewAdminUi({ businessId: BUSINESS_ID, marketMapping: {
      regions: MANAUS_COMMERCIAL_REGIONS,
      clusters: MANAUS_COMMERCIAL_CLUSTERS,
      mappedBusinesses: MANAUS_MAPPED_BUSINESSES,
    }}));
    return;
  }
  if (request.method === "GET" && pathname === "/operator") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(renderBasicPlanOperatorUi({ businessId: OPERATOR_BUSINESS_ID, businessName: "Oficina Intermediária Preview", integratedQuotes: true, integratedQuotePreview: { productDescription: OIL_PRODUCT, sku: OIL_SKU, quantity: 4, unit: "L", laborDescription: "Troca de óleo", laborQuantity: 1 } }));
    return;
  }
  if (request.method === "GET" && pathname === `/v1/businesses/${OPERATOR_BUSINESS_ID}/capabilities`) {
    sendJson(response, 200, await previewCapabilityPolicy.getCapabilities(OPERATOR_BUSINESS_ID));
    return;
  }

  const draftAuthorizeMatch = pathname.match(new RegExp(`^/v1/businesses/${OPERATOR_BUSINESS_ID}/quotes/([^/]+)/draft/authorize$`));
  if (request.method === "POST" && draftAuthorizeMatch) {
    const quoteRequestId = decodePathPart(draftAuthorizeMatch[1]);
    if (quoteRequestId === null) { sendJson(response, 400, { error: "Invalid path" }); return; }
    if (request.headers["content-length"] === "0") { sendJson(response, 400, { error: "INVALID_DRAFT_REFERENCE" }); return; }
    const body = await readJsonBody(request, response);
    if (body === undefined) return;
    const expected = parseExpectedDraftReference(body);
    if (expected === null) { sendJson(response, 400, { error: "INVALID_DRAFT_REFERENCE" }); return; }
    try {
      const draft = await authorizeQuoteDraft({ businessId: OPERATOR_BUSINESS_ID, quoteRequestId, expectedDraftId: expected.draftId, expectedRevision: expected.revision }, {
        quoteDraftRepository: previewQuoteDraftRepository,
        quoteRequestRepository: previewQuoteRequestRepository,
        opportunityRepository: previewOpportunityRepository,
        quoteTransaction: { run: (_businessId, _quoteRequestId, operation) => withSqliteTransaction(previewAdmin.database, operation) },
        commercialEventRepository: previewCommercialEventRepository,
        now: previewNow,
        generateId: previewGenerateId,
      });
      const item = items.find(({ quote }) => quote.id === quoteRequestId);
      if (item) {
        item.quote.status = QuoteRequestStatus.RESPONDED;
        item.quote.authorizedPrice = draft.total;
      }
      sendJson(response, 200, draft);
    } catch (error) { sendIntegratedError(response, error); }
    return;
  }

  const draftMatch = pathname.match(new RegExp(`^/v1/businesses/${OPERATOR_BUSINESS_ID}/quotes/([^/]+)/draft$`));
  if (draftMatch && (request.method === "GET" || request.method === "POST")) {
    const quoteRequestId = decodePathPart(draftMatch[1]);
    if (quoteRequestId === null) { sendJson(response, 400, { error: "Invalid path" }); return; }
    if (request.method === "GET") {
      const draft = await previewQuoteDraftRepository.findLatestByQuoteRequest(OPERATOR_BUSINESS_ID, quoteRequestId);
      if (!draft) sendJson(response, 404, { error: "QuoteDraft not found" });
      else sendJson(response, 200, draft);
      return;
    }
    const body = await readJsonBody(request, response);
    if (body === undefined) return;
    const parsedValue = parseIntegratedDraftBody(body);
    const parsed = parsedValue === null ? null : { products: parsedValue.products.map((product) => ({ ...product, quantitySource: "OPERATOR_CONFIRMED" as const })), labor: parsedValue.labor.map((labor) => ({ ...labor, quantitySource: "OPERATOR_CONFIRMED" as const })) };
    if (parsed === null) { sendJson(response, 400, { error: "Invalid quote draft lines" }); return; }
    try {
      const draft = await buildQuoteDraft({ businessId: OPERATOR_BUSINESS_ID, quoteRequestId, ...parsed }, {
        quoteRequestRepository: previewQuoteRequestRepository,
        stockCheckRepository: previewStockCheckRepository,
        inventoryReadPort: previewInventoryReadPort,
        productPriceReadPort: previewProductPriceReadPort,
        laborPriceReadPort: previewLaborPriceReadPort,
        quoteDraftRepository: previewQuoteDraftRepository,
        quoteTransaction: { run: (_businessId, _quoteRequestId, operation) => withSqliteTransaction(previewAdmin.database, operation) },
        now: previewNow,
        generateId: previewGenerateId,
      });
      sendJson(response, 201, draft);
    } catch (error) { sendIntegratedError(response, error); }
    return;
  }

  if (request.method === "GET" && (pathname === `/v1/businesses/${OPERATOR_BUSINESS_ID}/quotes/pending` || pathname === `/v1/businesses/${BUSINESS_ID}/quotes/pending`)) {
    const pending = items.filter(({ quote }) =>
      quote.status === QuoteRequestStatus.REQUESTED ||
      quote.status === QuoteRequestStatus.WAITING_INFORMATION ||
      quote.status === QuoteRequestStatus.WAITING_BUSINESS,
    );
    sendJson(response, 200, { items: pending });
    return;
  }

  const inventoryMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/quotes\/([^/]+)\/inventory$/);
  if (request.method === "GET" && inventoryMatch) {
    const businessId = decodePathPart(inventoryMatch[1]);
    const quoteRequestId = decodePathPart(inventoryMatch[2]);
    if (businessId === OPERATOR_BUSINESS_ID && quoteRequestId !== null) {
      const item = items.find(({ quote }) => quote.id === quoteRequestId);
      if (!item) { sendJson(response, 404, { error: "StockCheck not found" }); return; }
      sendJson(response, 200, await previewInventoryReadPort.check({ businessId, requestedItem: OIL_PRODUCT }));
      return;
    }
    if (businessId !== BUSINESS_ID || quoteRequestId === null) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const stockCheck = await previewStockCheckRepository.findLatestByQuoteRequest(businessId, quoteRequestId);
    if (stockCheck === null) {
      sendJson(response, 404, { error: "StockCheck not found" });
      return;
    }
    sendJson(response, 200, stockCheck);
    return;
  }

  const messagesMatch = pathname.match(/^\/v1\/businesses\/preview-intermediate-business\/conversations\/([^/]+)\/messages$/);
  if (request.method === "GET" && messagesMatch) {
    const conversationId = decodePathPart(messagesMatch[1]);
    if (conversationId === null) { sendJson(response, 400, { error: "Invalid conversation" }); return; }
    if (!await previewConversationRepository.findById(OPERATOR_BUSINESS_ID, conversationId)) { sendJson(response, 404, { error: "Conversation not found" }); return; }
    sendJson(response, 200, { messages: await previewMessageRepository.listByConversation(OPERATOR_BUSINESS_ID, conversationId) });
    return;
  }

  const respondMatch = pathname.match(/^\/v1\/businesses\/(?:preview-business|preview-intermediate-business)\/quotes\/([^/]+)\/respond$/);
  if (request.method === "POST" && respondMatch) {
    const quoteId = decodePathPart(respondMatch[1]);
    const body = await readJsonBody(request, response);
    if (body === undefined) return;
    if (
      quoteId === null ||
      !isRecord(body) ||
      typeof body.amountCents !== "number" ||
      !Number.isSafeInteger(body.amountCents) ||
      body.amountCents < 0 ||
      body.currency !== "BRL"
    ) {
      sendJson(response, 400, { error: "Invalid authorized price" });
      return;
    }
    const item = items.find(({ quote }) => quote.id === quoteId);
    if (!item) {
      sendJson(response, 404, { error: "QuoteRequest not found" });
      return;
    }
    if (item.quote.status !== QuoteRequestStatus.WAITING_BUSINESS) {
      sendJson(response, 409, { error: "QuoteRequest cannot be responded" });
      return;
    }
    item.quote.status = QuoteRequestStatus.RESPONDED;
    item.quote.authorizedPrice = { amountCents: body.amountCents, currency: "BRL" };
    sendJson(response, 200, {
      quoteRequestId: item.quote.id,
      opportunityId: item.quote.opportunityId,
      authorizedPrice: item.quote.authorizedPrice,
      quoteRequestStatus: item.quote.status,
      opportunityStatus: "WAITING_CUSTOMER",
    });
    return;
  }

  const publishMatch = pathname.match(/^\/v1\/businesses\/(?:preview-business|preview-intermediate-business)\/quotes\/([^/]+)\/publish$/);
  if (request.method === "POST" && publishMatch) {
    const quoteId = decodePathPart(publishMatch[1]);
    const itemIndex = items.findIndex(({ quote }) => quote.id === quoteId);
    const item = itemIndex >= 0 ? items[itemIndex] : undefined;
    if (!item) {
      sendJson(response, 404, { error: "QuoteRequest not found" });
      return;
    }
    if (item.quote.status !== QuoteRequestStatus.RESPONDED || !item.quote.authorizedPrice) {
      sendJson(response, 409, { error: "Authorized price cannot be presented" });
      return;
    }
    const content = `O orçamento autorizado é de ${new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(item.quote.authorizedPrice.amountCents / 100)}. Deseja prosseguir?`;
    const integratedDraft = await previewQuoteDraftRepository.findLatestByQuoteRequest(OPERATOR_BUSINESS_ID, quoteId!);
    if (integratedDraft) await previewQuoteDraftRepository.markPublished(OPERATOR_BUSINESS_ID, integratedDraft.id, previewNow());
    items.splice(itemIndex, 1);
    sendJson(response, 200, {
      messageId: "preview-message-published",
      conversationId: item.quote.conversationId,
      quoteRequestId: item.quote.id,
      content,
      channel: "WEB",
    });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function readJsonBody(request: IncomingMessage, response: ServerResponse): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      sendJson(response, 413, { error: "Payload too large" });
      return undefined;
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    sendJson(response, 400, { error: "Invalid JSON" });
    return undefined;
  }
}

function parseIntegratedDraftBody(value: unknown): { products: ProductDraftInput[]; labor: LaborDraftInput[] } | null {
  if (!isRecord(value)) return null;
  const productsValue = value.products === undefined ? [] : value.products;
  const laborValue = value.labor === undefined ? [] : value.labor;
  if (!Array.isArray(productsValue) || !Array.isArray(laborValue)) return null;
  const products: ProductDraftInput[] = [];
  for (const item of productsValue) {
    if (!isRecord(item) || typeof item.requestedItem !== "string" || typeof item.quantity !== "number" || !Number.isSafeInteger(item.quantity) || (item.quantitySource !== "OPERATOR_CONFIRMED" && item.quantitySource !== "WORKSHOP_SYSTEM")) return null;
    products.push({ requestedItem: item.requestedItem, quantity: item.quantity, quantitySource: item.quantitySource, ...(typeof item.inventoryReference === "string" ? { inventoryReference: item.inventoryReference } : {}), ...(typeof item.externalItemId === "string" ? { externalItemId: item.externalItemId } : {}), ...(typeof item.sku === "string" ? { sku: item.sku } : {}) });
  }
  const labor: LaborDraftInput[] = [];
  for (const item of laborValue) {
    if (!isRecord(item) || typeof item.description !== "string" || typeof item.quantity !== "number" || !Number.isSafeInteger(item.quantity) || (item.quantitySource !== "OPERATOR_CONFIRMED" && item.quantitySource !== "WORKSHOP_SYSTEM")) return null;
    labor.push({ description: item.description, quantity: item.quantity, quantitySource: item.quantitySource, ...(typeof item.serviceReference === "string" ? { serviceReference: item.serviceReference } : {}) });
  }
  return { products, labor };
}

function parseExpectedDraftReference(value: unknown): { draftId: string; revision: number } | null {
  if (!isRecord(value) || typeof value.draftId !== "string" || value.draftId.trim() === "" || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision <= 0) return null;
  return { draftId: value.draftId, revision: value.revision };
}

function sendIntegratedError(response: ServerResponse, error: unknown): void {
  if (error instanceof QuoteDraftError) {
    const status = error.code === "QUOTE_NOT_FOUND" ? 404 : error.code === "PRICE_UNAVAILABLE" ? 503 : error.code === "DRAFT_IMMUTABLE" || error.code === "DRAFT_NOT_APPROVABLE" || error.code === "QUOTE_DRAFT_CONFLICT" || error.code === "QUOTE_DRAFT_STALE" ? 409 : 400;
    sendJson(response, status, { error: error.code });
    return;
  }
  sendJson(response, 500, { error: "Internal server error" });
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodePathPart(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  server.listen(PORT, HOST, () => {
    console.log(`Operator preview: http://${HOST}:${PORT}/operator`);
  });
  const close = (): void => { server.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
