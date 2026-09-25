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

function createSampleItems(): PreviewQuoteItem[] {
  const createdAt = "2026-09-24T12:00:00.000Z";
  return [
    {
      quote: {
        id: "preview-quote-carlos",
        businessId: BUSINESS_ID,
        opportunityId: "preview-opportunity-carlos",
        conversationId: "preview-conversation-carlos",
        customerId: "preview-customer-carlos",
        vehicleId: "preview-vehicle-carlos",
        requestDescription: "Troca das pastilhas de freio",
        status: QuoteRequestStatus.WAITING_BUSINESS,
        requestedAt: "2026-09-24T10:15:00.000Z",
        createdAt,
        updatedAt: createdAt,
      },
      customer: {
        id: "preview-customer-carlos",
        businessId: BUSINESS_ID,
        name: "Carlos Almeida",
        primaryPhone: "(19) 99999-1234",
      },
      vehicle: {
        id: "preview-vehicle-carlos",
        businessId: BUSINESS_ID,
        brand: "Toyota",
        model: "Corolla",
        year: 2020,
        version: "XEi",
      },
      conversation: { id: "preview-conversation-carlos", businessId: BUSINESS_ID, channel: "WEB" },
    },
    {
      quote: {
        id: "preview-quote-mariana",
        businessId: BUSINESS_ID,
        opportunityId: "preview-opportunity-mariana",
        conversationId: "preview-conversation-mariana",
        customerId: "preview-customer-mariana",
        vehicleId: "preview-vehicle-mariana",
        requestDescription: "Revisão do ar-condicionado",
        symptomDescription: "Não está gelando",
        status: QuoteRequestStatus.WAITING_INFORMATION,
        requestedAt: "2026-09-24T10:30:00.000Z",
        createdAt,
        updatedAt: createdAt,
      },
      customer: {
        id: "preview-customer-mariana",
        businessId: BUSINESS_ID,
        name: "Mariana Souza",
      },
      vehicle: {
        id: "preview-vehicle-mariana",
        businessId: BUSINESS_ID,
        brand: "Volkswagen",
        model: "T-Cross",
        year: 2023,
      },
      conversation: { id: "preview-conversation-mariana", businessId: BUSINESS_ID, channel: "WEB" },
    },
    {
      quote: {
        id: "preview-quote-roberto",
        businessId: BUSINESS_ID,
        opportunityId: "preview-opportunity-roberto",
        conversationId: "preview-conversation-roberto",
        customerId: "preview-customer-roberto",
        vehicleId: "preview-vehicle-roberto",
        requestDescription: "Orçamento para película automotiva",
        status: QuoteRequestStatus.REQUESTED,
        requestedAt: "2026-09-24T11:00:00.000Z",
        createdAt,
        updatedAt: createdAt,
      },
      customer: {
        id: "preview-customer-roberto",
        businessId: BUSINESS_ID,
        name: "Roberto Lima",
      },
      vehicle: {
        id: "preview-vehicle-roberto",
        businessId: BUSINESS_ID,
        brand: "Chevrolet",
        model: "Onix",
        year: 2021,
      },
      conversation: { id: "preview-conversation-roberto", businessId: BUSINESS_ID, channel: "WEB" },
    },
  ];
}

let items = createSampleItems();

function createSampleHistories(): Map<string, Array<{
  id: string;
  businessId: string;
  conversationId: string;
  senderType: "CUSTOMER" | "ASSISTANT";
  channel: "WEB";
  content: string;
  createdAt: string;
}>> {
  const message = (
    conversationId: string,
    id: string,
    senderType: "CUSTOMER" | "ASSISTANT",
    content: string,
    createdAt: string,
  ) => ({ id, businessId: BUSINESS_ID, conversationId, senderType, channel: "WEB" as const, content, createdAt });

  return new Map([
    ["preview-conversation-carlos", [
      message("preview-conversation-carlos", "preview-carlos-1", "CUSTOMER", "Olá, tenho um Corolla XEi 2020 e preciso trocar as pastilhas de freio.", "2026-09-24T10:12:00.000Z"),
      message("preview-conversation-carlos", "preview-carlos-2", "ASSISTANT", "Posso registrar seu pedido de orçamento. Vou encaminhar os dados do veículo para a equipe.", "2026-09-24T10:12:08.000Z"),
      message("preview-conversation-carlos", "preview-carlos-3", "CUSTOMER", "Perfeito, obrigado.", "2026-09-24T10:13:00.000Z"),
    ]],
    ["preview-conversation-mariana", [
      message("preview-conversation-mariana", "preview-mariana-1", "CUSTOMER", "O ar do meu T-Cross parou de gelar.", "2026-09-24T10:28:00.000Z"),
      message("preview-conversation-mariana", "preview-mariana-2", "ASSISTANT", "Para registrar corretamente, preciso confirmar mais algumas informações. O ar parou de gelar de repente ou foi perdendo a eficiência aos poucos?", "2026-09-24T10:28:10.000Z"),
    ]],
    ["preview-conversation-roberto", [
      message("preview-conversation-roberto", "preview-roberto-1", "CUSTOMER", "Quanto fica para colocar película no meu Onix 2021?", "2026-09-24T10:58:00.000Z"),
      message("preview-conversation-roberto", "preview-roberto-2", "ASSISTANT", "Vou registrar sua solicitação.", "2026-09-24T10:58:06.000Z"),
    ]],
  ]);
}

const sampleHistories = createSampleHistories();

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
    items = createSampleItems();
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(renderBasicPlanOperatorUi({ businessId: BUSINESS_ID, businessName: "Oficina de Demonstração" }));
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
    const conversationId = decodePathPart(messagesMatch[1]);
    const messages = conversationId === null ? undefined : sampleHistories.get(conversationId);
    if (!messages) {
      sendJson(response, 404, { error: "Conversation not found" });
      return;
    }
    sendJson(response, 200, { messages });
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
