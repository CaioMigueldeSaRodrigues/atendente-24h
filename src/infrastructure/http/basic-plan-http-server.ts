import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AppointmentRepository, CommercialEventRepository, ConversationRepository, CustomerRepository, HumanHandoffRepository, MessageRepository, OpportunityRepository, QuoteRequestRepository, VehicleRepository } from "../../core/repositories.js";
import type { MessageInterpreter } from "../../core/message-interpreter.js";
import { Channel, ConversationStatus, QuoteRequestStatus } from "../../core/domain/enums.js";
import type { Channel as ChannelType } from "../../core/domain/enums.js";
import type { Conversation } from "../../core/domain/entities.js";
import { processMessage } from "../../core/process-message.js";
import { respondToQuote } from "../../core/respond-to-quote.js";
import { publishAuthorizedQuote } from "../../core/publish-authorized-quote.js";
import { renderBasicPlanOperatorUi, type BasicPlanOperatorConfig } from "./basic-plan-operator-ui.js";

const MAX_BODY_BYTES = 1024 * 1024;

export type BasicPlanHttpServerDependencies = {
  conversationRepository: ConversationRepository;
  messageRepository: MessageRepository;
  customerRepository: CustomerRepository;
  vehicleRepository: VehicleRepository;
  opportunityRepository: OpportunityRepository;
  quoteRequestRepository: QuoteRequestRepository;
  appointmentRepository: AppointmentRepository;
  humanHandoffRepository: HumanHandoffRepository;
  commercialEventRepository?: CommercialEventRepository;
  operator: BasicPlanOperatorConfig;
  interpreter: MessageInterpreter;
  now: () => string;
  generateId: (prefix: string) => string;
};

export function createBasicPlanHttpServer(
  dependencies: BasicPlanHttpServerDependencies,
): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, dependencies).catch((cause: unknown) => {
      const error = mapError(cause);
      sendError(response, error.status, error.body);
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: BasicPlanHttpServerDependencies,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/operator") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(renderBasicPlanOperatorUi(dependencies.operator));
    return;
  }

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  const createConversationMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/conversations$/);
  if (request.method === "POST" && createConversationMatch) {
    const businessId = decodePathPart(createConversationMatch[1]);
    if (businessId === null) {
      sendError(response, 400, "Invalid businessId");
      return;
    }
    const body = await readJsonBody(request, response);
    if (body === undefined) return;
    if (!isRecord(body) || typeof body.channel !== "string" || !isChannel(body.channel)) {
      sendError(response, 400, "Invalid channel");
      return;
    }
    const timestamp = dependencies.now();
    const conversation: Conversation = {
      id: dependencies.generateId("conversation"),
      businessId,
      channel: body.channel,
      status: ConversationStatus.ACTIVE,
      startedAt: timestamp,
      lastMessageAt: timestamp,
    };
    await dependencies.conversationRepository.save(conversation);
    sendJson(response, 201, {
      conversationId: conversation.id,
      businessId: conversation.businessId,
      channel: conversation.channel,
      status: conversation.status,
    });
    return;
  }

  const conversationMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/conversations\/([^/]+)\/messages$/);
  if (conversationMatch) {
    const businessId = decodePathPart(conversationMatch[1]);
    const conversationId = decodePathPart(conversationMatch[2]);
    if (businessId === null || conversationId === null) {
      sendError(response, 400, "Invalid path");
      return;
    }
    if (request.method === "GET") {
      const messages = await dependencies.messageRepository.listByConversation(businessId, conversationId);
      sendJson(response, 200, { messages });
      return;
    }
    if (request.method === "POST") {
      const body = await readJsonBody(request, response);
      if (body === undefined) return;
      if (!isRecord(body) || typeof body.content !== "string" || body.content.trim().length === 0) {
        sendError(response, 400, "Invalid content");
        return;
      }
      const result = await processMessage({ businessId, conversationId, content: body.content }, dependencies);
      sendJson(response, 200, result);
      return;
    }
  }

  const quotesListMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/conversations\/([^/]+)\/quotes$/);
  if (request.method === "GET" && quotesListMatch) {
    const businessId = decodePathPart(quotesListMatch[1]);
    const conversationId = decodePathPart(quotesListMatch[2]);
    if (businessId === null || conversationId === null) {
      sendError(response, 400, "Invalid path");
      return;
    }
    const quotes = await dependencies.quoteRequestRepository.listByConversation(businessId, conversationId);
    sendJson(response, 200, { quotes });
    return;
  }

  const pendingQuotesMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/quotes\/pending$/);
  if (request.method === "GET" && pendingQuotesMatch) {
    const businessId = decodePathPart(pendingQuotesMatch[1]);
    if (businessId === null) {
      sendError(response, 400, "Invalid businessId");
      return;
    }
    const pendingStatuses = new Set([
      QuoteRequestStatus.REQUESTED,
      QuoteRequestStatus.WAITING_INFORMATION,
      QuoteRequestStatus.WAITING_BUSINESS,
    ]);
    const quotes = (await dependencies.quoteRequestRepository.listByBusiness(businessId))
      .filter((quote) => pendingStatuses.has(quote.status));
    const items = await Promise.all(quotes.map(async (quote) => {
      const [customer, vehicle, conversation] = await Promise.all([
        quote.customerId === undefined
          ? Promise.resolve(null)
          : dependencies.customerRepository.findById(businessId, quote.customerId),
        quote.vehicleId === undefined
          ? Promise.resolve(null)
          : dependencies.vehicleRepository.findById(businessId, quote.vehicleId),
        dependencies.conversationRepository.findById(businessId, quote.conversationId),
      ]);
      return { quote, customer, vehicle, conversation };
    }));
    sendJson(response, 200, { items });
    return;
  }

  const quoteActionMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/quotes\/([^/]+)\/(respond|publish)$/);
  if (request.method === "POST" && quoteActionMatch) {
    const businessId = decodePathPart(quoteActionMatch[1]);
    const quoteRequestId = decodePathPart(quoteActionMatch[2]);
    if (businessId === null || quoteRequestId === null) {
      sendError(response, 400, "Invalid path");
      return;
    }
    if (quoteActionMatch[3] === "respond") {
      const body = await readJsonBody(request, response);
      if (body === undefined) return;
      if (!isRecord(body) || typeof body.amountCents !== "number" || !Number.isSafeInteger(body.amountCents) || body.amountCents < 0 || body.currency !== "BRL") {
        sendError(response, 400, "Invalid authorized price");
        return;
      }
      const result = await respondToQuote({
        businessId,
        quoteRequestId,
        authorizedPrice: { amountCents: body.amountCents, currency: "BRL" },
      }, dependencies);
      sendJson(response, 200, result);
      return;
    }
    const result = await publishAuthorizedQuote({ businessId, quoteRequestId }, dependencies);
    sendJson(response, 200, result);
    return;
  }

  sendError(response, 404, "Not found");
}

async function readJsonBody(request: IncomingMessage, response: ServerResponse): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) chunks.push(buffer);
  }
  if (tooLarge) {
    sendError(response, 413, "Payload too large");
    return undefined;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    sendError(response, 400, "Invalid JSON");
    return undefined;
  }
}

function mapError(cause: unknown): { status: number; body: string } {
  const message = cause instanceof Error ? cause.message : "";
  if (message === "Conversation not found" || message === "QuoteRequest not found" || message === "Opportunity not found") {
    return { status: 404, body: message };
  }
  if (message === "QuoteRequest cannot be responded" || message === "Authorized price cannot be presented") {
    return { status: 409, body: message };
  }
  if (message === "authorizedPrice is invalid") {
    return { status: 400, body: message };
  }
  return { status: 500, body: "Internal server error" };
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, statusCode: number, error: string): void {
  sendJson(response, statusCode, { error });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChannel(value: string): value is ChannelType {
  return Object.values(Channel).some((channel) => channel === value);
}

function decodePathPart(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}
