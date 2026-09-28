import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { QuoteRequestStatus } from "../core/domain/enums.js";
import { MANAUS_COMMERCIAL_CLUSTERS, MANAUS_COMMERCIAL_REGIONS, MANAUS_MAPPED_BUSINESSES } from "./manaus-market-mapping.js";
import { renderAmpliviewAdminUi, type AmpliviewAdminData } from "../infrastructure/http/ampliview-admin-ui.js";
import { renderBasicPlanAuthUi } from "../infrastructure/http/basic-plan-auth-ui.js";
import { renderBasicPlanOperatorUi } from "../infrastructure/http/basic-plan-operator-ui.js";

const HOST = "127.0.0.1";
const PORT = 3001;
const BUSINESS_ID = "preview-business";
const MAX_BODY_BYTES = 1024 * 1024;

const adminOperationalData: AmpliviewAdminData = {
  overview: {
    activeBusinesses: 0,
    attendances: 0,
    commercialRequests: 0,
    respondedQuotes: 0,
    authorizedAmountCents: 0,
    aiResolutionPercent: 0,
    attendancePeriods: [],
    businessesByRegion: [],
    channels: [],
    commercialResults: [],
    operationalAlerts: [],
  },
  attendances: [],
  assistantHealth: { issues: [], causes: [] },
  regionalAdoption: [],
  coverageDeficits: [],
  demand: [],
  merchandising: {
    unexploredDemand: [],
    opportunitiesByRegion: [],
    opportunitiesBySegment: [],
    productTrends: [],
  },
  businesses: [],
};

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
    channel: "WEB";
  };
};

let items: PreviewQuoteItem[] = [];

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
  if (request.method === "GET" && pathname === "/admin") {
    sendHtml(response, renderAmpliviewAdminUi(adminOperationalData, {
      regions: MANAUS_COMMERCIAL_REGIONS,
      clusters: MANAUS_COMMERCIAL_CLUSTERS,
      mappedBusinesses: MANAUS_MAPPED_BUSINESSES,
    }));
    return;
  }
  if (request.method === "GET" && pathname === "/operator") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(renderBasicPlanOperatorUi({ businessId: BUSINESS_ID, businessName: "Empresa não configurada" }));
    return;
  }

  if (request.method === "GET" && pathname === `/v1/businesses/${BUSINESS_ID}/quotes/pending`) {
    const pending = items.filter(({ quote }) =>
      quote.status === QuoteRequestStatus.REQUESTED ||
      quote.status === QuoteRequestStatus.WAITING_INFORMATION ||
      quote.status === QuoteRequestStatus.WAITING_BUSINESS,
    );
    sendJson(response, 200, { items: pending });
    return;
  }

  const messagesMatch = pathname.match(/^\/v1\/businesses\/preview-business\/conversations\/([^/]+)\/messages$/);
  if (request.method === "GET" && messagesMatch) {
    sendJson(response, 404, { error: "Conversation not found" });
    return;
  }

  const respondMatch = pathname.match(/^\/v1\/businesses\/preview-business\/quotes\/([^/]+)\/respond$/);
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

  const publishMatch = pathname.match(/^\/v1\/businesses\/preview-business\/quotes\/([^/]+)\/publish$/);
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
