import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AppointmentRepository, CommercialEventRepository, ConversationRepository, CustomerRepository, HumanHandoffRepository, MessageRepository, OpportunityRepository, OutboundDeliveryRepository, QuoteRequestRepository, StockCheckRepository, VehicleRepository } from "../../core/repositories.js";
import type { MessageInterpreter } from "../../core/message-interpreter.js";
import { Channel, ConversationStatus, Intent, InventoryAvailability, OutboundDeliveryStatus, QuoteRequestStatus } from "../../core/domain/enums.js";
import type { Channel as ChannelType } from "../../core/domain/enums.js";
import type { Conversation } from "../../core/domain/entities.js";
import { processMessage } from "../../core/process-message.js";
import { respondToQuote } from "../../core/respond-to-quote.js";
import { publishAuthorizedQuote } from "../../core/publish-authorized-quote.js";
import { outboundDeliveryLeaseUntil } from "../../core/outbound-delivery-policy.js";
import { parseEvolutionGoInboundText } from "../../channels/whatsapp/evolution-go-message-parser.js";
import {
  authenticateEvolutionGoWebhook,
  type EvolutionGoWebhookCredential,
} from "../../channels/whatsapp/evolution-go-webhook-auth.js";
import type { EvolutionGoWebhookReplayGuard } from "../../channels/whatsapp/evolution-go-webhook-replay-guard.js";
import type { EvolutionGoConversationLinkRepository } from "../../channels/whatsapp/evolution-go-conversation-link.js";
import type { EvolutionGoTextMessage } from "../../channels/whatsapp/evolution-go-text-sender.js";
import type { EvolutionGoWebhookTransaction } from "../../channels/whatsapp/evolution-go-webhook-transaction.js";
import type { ChannelTextSender } from "../../channels/channel-text-sender.js";
import { resolveEvolutionGoConversation } from "../../channels/whatsapp/evolution-go-conversation-resolver.js";
import { renderBasicPlanOperatorUi, type BasicPlanOperatorConfig } from "./basic-plan-operator-ui.js";
import type { AdminBusinessScopeAuthorizer, AdminQueryService } from "../../core/admin-read-model.js";
import { parseAdminPagination, parseAdminPeriod } from "../../core/admin-read-model.js";
import { checkInventory } from "../../core/check-inventory.js";
import type { InventoryReadPort } from "../../core/inventory-read-port.js";

const MAX_BODY_BYTES = 1024 * 1024;

type PublishedQuoteDeliveryStatus =
  | "DELIVERED"
  | "ALREADY_DELIVERED"
  | "SENDING"
  | "NOT_CONFIGURED"
  | "RECIPIENT_NOT_FOUND"
  | "FAILED";

type PublishedQuoteDelivery = {
  status: PublishedQuoteDeliveryStatus;
  retryable: boolean;
};

type PublishedQuoteDeliveryState = {
  inFlight: Map<string, Promise<PublishedQuoteDelivery>>;
  publishing: Map<string, Promise<{
    result: AtomicPublishedQuote["result"];
    delivery: PublishedQuoteDelivery;
  }>>;
};

type PublishedQuoteDeliveryInput = {
  businessId: string;
  messageId: string;
  quoteRequestId: string;
  conversationId: string;
  channel: ChannelType;
  content: string;
  outboundDeliveryId: string;
};

export type BasicPlanHttpServerDependencies = {
  conversationRepository: ConversationRepository;
  messageRepository: MessageRepository;
  customerRepository: CustomerRepository;
  vehicleRepository: VehicleRepository;
  opportunityRepository: OpportunityRepository;
  quoteRequestRepository: QuoteRequestRepository;
  outboundDeliveryRepository: OutboundDeliveryRepository;
  appointmentRepository: AppointmentRepository;
  humanHandoffRepository: HumanHandoffRepository;
  inventoryReadPort?: InventoryReadPort;
  stockCheckRepository?: StockCheckRepository;
  commercialEventRepository?: CommercialEventRepository;
  evolutionGoWebhookCredentials?: EvolutionGoWebhookCredential[];
  evolutionGoWebhookReplayGuard?: EvolutionGoWebhookReplayGuard;
  evolutionGoConversationLinkRepository?: EvolutionGoConversationLinkRepository;
  evolutionGoTextSender?: { sendText(message: EvolutionGoTextMessage): Promise<void> };
  channelTextSenders?: Partial<Record<ChannelType, ChannelTextSender>>;
  adminQueryService?: AdminQueryService;
  adminBusinessScopeAuthorizer?: AdminBusinessScopeAuthorizer;
  evolutionGoWebhookTransaction: EvolutionGoWebhookTransaction;
  operator: BasicPlanOperatorConfig;
  interpreter: MessageInterpreter;
  now: () => string;
  generateId: (prefix: string) => string;
};

export type AdminHttpServerDependencies = Pick<
  BasicPlanHttpServerDependencies,
  "adminQueryService" | "adminBusinessScopeAuthorizer"
>;

export function createBasicPlanHttpServer(
  dependencies: BasicPlanHttpServerDependencies,
): Server {
  const deliveryState: PublishedQuoteDeliveryState = {
    inFlight: new Map(),
    publishing: new Map(),
  };
  return createServer((request, response) => {
    void handleRequest(request, response, dependencies, deliveryState).catch((cause: unknown) => {
      const error = mapError(cause);
      sendError(response, error.status, error.body);
    });
  });
}

async function deliverPublishedQuote(
  input: PublishedQuoteDeliveryInput,
  dependencies: BasicPlanHttpServerDependencies,
  state: PublishedQuoteDeliveryState,
): Promise<PublishedQuoteDelivery> {
  const repository = dependencies.outboundDeliveryRepository;
  const key = `${input.businessId}:${input.outboundDeliveryId}`;
  let delivery = await repository.findById(input.businessId, input.outboundDeliveryId);
  if (delivery === null) throw new Error("OutboundDelivery not found");
  if (delivery?.status === OutboundDeliveryStatus.DELIVERED) {
    return { status: "ALREADY_DELIVERED", retryable: false };
  }
  if (delivery?.status === OutboundDeliveryStatus.FAILED_FINAL) {
    return deliveryFailureResult(delivery.lastError);
  }

  const current = state.inFlight.get(key);
  if (current !== undefined) return current;

  const deliveryAttempt = (async (): Promise<PublishedQuoteDelivery> => {
    let currentDelivery = delivery;

    if (currentDelivery.status === OutboundDeliveryStatus.DELIVERED) {
      return { status: "ALREADY_DELIVERED", retryable: false };
    }
    if (currentDelivery.status === OutboundDeliveryStatus.FAILED_FINAL) {
      return deliveryFailureResult(currentDelivery.lastError);
    }

    const claim = await repository.claimForSending(
      input.businessId,
      currentDelivery.id,
      dependencies.now(),
      outboundDeliveryLeaseUntil(dependencies.now()),
      dependencies.generateId("outbound-claim"),
    );
    if (!claim.claimed) {
      if (claim.delivery.status === OutboundDeliveryStatus.DELIVERED) {
        return { status: "ALREADY_DELIVERED", retryable: false };
      }
      if (claim.delivery.status === OutboundDeliveryStatus.SENDING) {
        return { status: "SENDING", retryable: true };
      }
      if (claim.delivery.status === OutboundDeliveryStatus.FAILED_FINAL) {
        return deliveryFailureResult(claim.delivery.lastError);
      }
      return { status: "FAILED", retryable: claim.delivery.status === OutboundDeliveryStatus.FAILED_RETRYABLE };
    }

    const sender = dependencies.channelTextSenders?.[input.channel];
    if (!sender) {
      const retryable = input.channel === Channel.WHATSAPP;
      await repository.markFailed(input.businessId, currentDelivery.id, {
        status: retryable ? OutboundDeliveryStatus.FAILED_RETRYABLE : OutboundDeliveryStatus.FAILED_FINAL,
        lastError: CHANNEL_SENDER_NOT_CONFIGURED,
        ...(retryable ? { nextAttemptAt: dependencies.now() } : {}),
        updatedAt: dependencies.now(),
      }, claim.delivery.claimToken!);
      return { status: "NOT_CONFIGURED", retryable };
    }

    if (input.channel !== Channel.WHATSAPP) {
      await repository.markFailed(input.businessId, currentDelivery.id, {
        status: OutboundDeliveryStatus.FAILED_FINAL,
        lastError: CHANNEL_SENDER_NOT_CONFIGURED,
        updatedAt: dependencies.now(),
      }, claim.delivery.claimToken!);
      return { status: "NOT_CONFIGURED", retryable: false };
    }

    if (currentDelivery.recipientRef === undefined) {
      const recipient = await resolveDeliveryRecipient(input, dependencies);
      const retryable = recipient.retryable;
      await repository.markFailed(input.businessId, currentDelivery.id, {
        status: retryable ? OutboundDeliveryStatus.FAILED_RETRYABLE : OutboundDeliveryStatus.FAILED_FINAL,
        lastError: recipient.retryable ? RECIPIENT_REPOSITORY_NOT_CONFIGURED : RECIPIENT_NOT_FOUND,
        ...(retryable ? { nextAttemptAt: dependencies.now() } : {}),
        updatedAt: dependencies.now(),
      }, claim.delivery.claimToken!);
      return { status: "RECIPIENT_NOT_FOUND", retryable };
    }

    try {
      await sender.sendText({ recipientJid: currentDelivery.recipientRef, content: input.content });
    } catch (cause) {
      await repository.markFailed(input.businessId, currentDelivery.id, {
        status: OutboundDeliveryStatus.FAILED_RETRYABLE,
        lastError: errorMessage(cause),
        nextAttemptAt: dependencies.now(),
        updatedAt: dependencies.now(),
      }, claim.delivery.claimToken!);
      return { status: "FAILED", retryable: true };
    }

    await repository.markDelivered(
      input.businessId,
      currentDelivery.id,
      dependencies.now(),
      dependencies.now(),
      claim.delivery.claimToken!,
    );
    return { status: "DELIVERED", retryable: false };
  })();

  state.inFlight.set(key, deliveryAttempt);
  try {
    return await deliveryAttempt;
  } finally {
    if (state.inFlight.get(key) === deliveryAttempt) state.inFlight.delete(key);
  }
}

const CHANNEL_SENDER_NOT_CONFIGURED = "Channel sender is not configured";
const RECIPIENT_REPOSITORY_NOT_CONFIGURED = "WhatsApp conversation link repository is not configured";
const RECIPIENT_NOT_FOUND = "WhatsApp conversation recipient link not found";

async function resolveDeliveryRecipient(
  input: Pick<PublishedQuoteDeliveryInput, "businessId" | "conversationId" | "channel">,
  dependencies: BasicPlanHttpServerDependencies,
): Promise<{ recipientRef?: string; retryable: boolean }> {
  if (input.channel !== Channel.WHATSAPP) return { retryable: false };
  const linkRepository = dependencies.evolutionGoConversationLinkRepository;
  if (!linkRepository) return { retryable: true };
  const link = await linkRepository.findByConversation(input.businessId, input.conversationId);
  if (
    link === null ||
    link.businessId !== input.businessId ||
    link.conversationId !== input.conversationId ||
    link.senderJid.trim().length === 0
  ) return { retryable: false };
  return { recipientRef: link.senderJid, retryable: false };
}

type AtomicPublishedQuote = {
  result: Awaited<ReturnType<typeof publishAuthorizedQuote>>;
  outboundDeliveryId: string;
};

async function publishPublishedQuoteAtomically(
  input: { businessId: string; quoteRequestId: string },
  dependencies: BasicPlanHttpServerDependencies,
): Promise<AtomicPublishedQuote> {
  const quote = await dependencies.quoteRequestRepository.findById(input.businessId, input.quoteRequestId);
  if (quote === null) throw new Error("QuoteRequest not found");
  const conversation = await dependencies.conversationRepository.findById(input.businessId, quote.conversationId);
  if (conversation === null) throw new Error("Conversation not found");
  const recipient = await resolveDeliveryRecipient({
    businessId: input.businessId,
    conversationId: conversation.id,
    channel: conversation.channel,
  }, dependencies);
  return dependencies.evolutionGoWebhookTransaction.run(async () => {
    const now = dependencies.now();
    const reservation = await dependencies.outboundDeliveryRepository.reserve({
      id: dependencies.generateId("outbound-delivery"),
      businessId: input.businessId,
      quoteRequestId: quote.id,
      conversationId: conversation.id,
      channel: conversation.channel,
      ...(recipient.recipientRef === undefined ? {} : { recipientRef: recipient.recipientRef }),
      status: OutboundDeliveryStatus.PENDING,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (!reservation.created) {
      if (reservation.delivery.messageId === undefined) throw new Error("OutboundDelivery has no published message");
      const messages = await dependencies.messageRepository.listByConversation(input.businessId, conversation.id);
      const message = messages.find((candidate) => candidate.id === reservation.delivery.messageId);
      if (message === undefined) throw new Error("Published Message not found");
      return {
        result: {
          messageId: message.id,
          conversationId: conversation.id,
          quoteRequestId: quote.id,
          channel: message.channel,
          content: message.content,
        },
        outboundDeliveryId: reservation.delivery.id,
      };
    }
    const result = await publishAuthorizedQuote(
      { businessId: input.businessId, quoteRequestId: input.quoteRequestId },
      { ...dependencies, strictCommercialEventPersistence: true },
    );
    await dependencies.outboundDeliveryRepository.attachMessage(input.businessId, reservation.delivery.id, result.messageId, dependencies.now());
    return { result, outboundDeliveryId: reservation.delivery.id };
  });
}

function deliveryFailureResult(lastError: string | undefined): PublishedQuoteDelivery {
  if (lastError === CHANNEL_SENDER_NOT_CONFIGURED) return { status: "NOT_CONFIGURED", retryable: false };
  if (lastError === RECIPIENT_NOT_FOUND || lastError === RECIPIENT_REPOSITORY_NOT_CONFIGURED) {
    return { status: "RECIPIENT_NOT_FOUND", retryable: lastError === RECIPIENT_REPOSITORY_NOT_CONFIGURED };
  }
  return { status: "FAILED", retryable: false };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : "Channel sender failed";
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: BasicPlanHttpServerDependencies,
  deliveryState: PublishedQuoteDeliveryState,
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

  if (pathname.startsWith("/v1/admin/")) {
    await handleAdminRequest(url, request, response, dependencies);
    return;
  }

  if (request.method === "POST" && pathname === "/v1/channels/whatsapp/evolution-go/webhook") {
    const credentials = dependencies.evolutionGoWebhookCredentials;
    if (!credentials || credentials.length === 0) {
      sendError(response, 404, "Not found");
      return;
    }
    const payload = await readJsonBody(request, response);
    if (payload === undefined) return;
    const authenticatedWebhook = authenticateEvolutionGoWebhook(payload, credentials);
    if (authenticatedWebhook === null) {
      sendError(response, 401, "Unauthorized");
      return;
    }
    const message = parseEvolutionGoInboundText(payload);
    if (message === null) {
      sendJson(response, 202, { accepted: false, reason: "ignored_event" });
      return;
    }
    const replayGuard = dependencies.evolutionGoWebhookReplayGuard;
    const linkRepository = dependencies.evolutionGoConversationLinkRepository;
    const textSender = dependencies.evolutionGoTextSender;
    if (!replayGuard || !linkRepository || !textSender) {
      sendError(response, 503, "Service unavailable");
      return;
    }
    const receivedAt = dependencies.now();
    const claimToken = dependencies.generateId("webhook-claim");
    let claim: Awaited<ReturnType<EvolutionGoWebhookReplayGuard["claim"]>>;
    try {
      claim = await replayGuard.claim({
        businessId: authenticatedWebhook.businessId,
        instanceName: authenticatedWebhook.instanceName,
        externalMessageId: message.externalMessageId,
        receivedAt,
        claimedAt: receivedAt,
        leaseUntil: new Date(Date.parse(receivedAt) + 5 * 60 * 1000).toISOString(),
        claimToken,
      });
    } catch (cause) {
      if (cause instanceof Error && /SQLite connection is busy|database is locked/i.test(cause.message)) {
        sendError(response, 503, "Service unavailable");
        return;
      }
      throw cause;
    }
    if (claim.status === "duplicate") {
      sendJson(response, 202, { accepted: false, reason: "duplicate_message" });
      return;
    }
    if (claim.status === "in_progress") {
      sendError(response, 503, "Service unavailable");
      return;
    }
    const activeClaim = claim.status === "claimed" ? claim : undefined;
    let processed = claim.status === "processed" ? claim.processed : undefined;
    if (processed === undefined) {
      if (activeClaim === undefined) {
        sendError(response, 503, "Service unavailable");
        return;
      }
      try {
        processed = await dependencies.evolutionGoWebhookTransaction.run(async () => {
          const locked = await replayGuard.lockForProcessing({
            businessId: authenticatedWebhook.businessId,
            instanceName: authenticatedWebhook.instanceName,
            externalMessageId: message.externalMessageId,
            claimToken: activeClaim.claimToken,
          });
          if (!locked) throw new Error("Evolution Go webhook claim is no longer active");

          const resolved = await resolveEvolutionGoConversation({
            businessId: authenticatedWebhook.businessId,
            instanceName: authenticatedWebhook.instanceName,
            senderJid: message.senderJid,
          }, {
            conversationRepository: dependencies.conversationRepository,
            evolutionGoConversationLinkRepository: linkRepository,
            now: dependencies.now,
            generateId: dependencies.generateId,
          });
          const result = await processMessage({
            businessId: authenticatedWebhook.businessId,
            conversationId: resolved.conversation.id,
            content: message.content,
          }, dependencies);
          const persisted = await replayGuard.markProcessed({
            businessId: authenticatedWebhook.businessId,
            instanceName: authenticatedWebhook.instanceName,
            externalMessageId: message.externalMessageId,
            claimToken: activeClaim.claimToken,
            conversationId: resolved.conversation.id,
            senderJid: message.senderJid,
            reply: result.reply,
          });
          if (!persisted) throw new Error("Unable to persist Evolution Go webhook result");
          return {
            conversationId: resolved.conversation.id,
            senderJid: message.senderJid,
            reply: result.reply,
          };
        });
      } catch (error) {
        await replayGuard.release({
          businessId: authenticatedWebhook.businessId,
          instanceName: authenticatedWebhook.instanceName,
          externalMessageId: message.externalMessageId,
          claimToken: activeClaim.claimToken,
        });
        throw error;
      }
    }

    try {
      await textSender.sendText({
        recipientJid: processed.senderJid,
        content: processed.reply,
      });
    } catch {
      sendError(response, 503, "Service unavailable");
      return;
    }
    const sent = await replayGuard.markSent({
      businessId: authenticatedWebhook.businessId,
      instanceName: authenticatedWebhook.instanceName,
      externalMessageId: message.externalMessageId,
      sentAt: dependencies.now(),
    });
    if (!sent) {
      sendError(response, 503, "Service unavailable");
      return;
    }
    sendJson(response, 202, { accepted: true, message });
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

  const quoteInventoryMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/quotes\/([^/]+)\/inventory$/);
  if (quoteInventoryMatch && (request.method === "GET" || request.method === "POST")) {
    const businessId = decodePathPart(quoteInventoryMatch[1]);
    const quoteRequestId = decodePathPart(quoteInventoryMatch[2]);
    if (businessId === null || quoteRequestId === null) {
      sendError(response, 400, "Invalid path");
      return;
    }
    if (!dependencies.stockCheckRepository) {
      sendError(response, 503, "Inventory read model is not configured");
      return;
    }
    if (request.method === "GET") {
      const result = await dependencies.stockCheckRepository.findLatestByQuoteRequest(businessId, quoteRequestId);
      if (result === null) {
        sendError(response, 404, "StockCheck not found");
        return;
      }
      sendJson(response, 200, result);
      return;
    }
    if (!dependencies.inventoryReadPort) {
      sendError(response, 503, "Inventory provider is not configured");
      return;
    }
    const quote = await dependencies.quoteRequestRepository.findById(businessId, quoteRequestId);
    if (quote === null) {
      sendError(response, 404, "QuoteRequest not found");
      return;
    }
    const vehicle = quote.vehicleId === undefined ? undefined : await dependencies.vehicleRepository.findById(businessId, quote.vehicleId);
    const conversation = await dependencies.conversationRepository.findById(businessId, quote.conversationId);
    if (conversation === null) {
      sendError(response, 404, "Conversation not found");
      return;
    }
    const result = await checkInventory({
      businessId,
      conversationId: conversation.id,
      quoteRequestId: quote.id,
      ...(quote.vehicleId === undefined ? {} : { vehicleId: quote.vehicleId }),
      requestedItem: quote.requestDescription,
      ...(vehicle === null || vehicle === undefined ? {} : {
        vehicle: {
          ...(vehicle.brand === undefined ? {} : { brand: vehicle.brand }),
          ...(vehicle.model === undefined ? {} : { model: vehicle.model }),
          ...(vehicle.year === undefined ? {} : { year: vehicle.year }),
          ...(vehicle.version === undefined ? {} : { version: vehicle.version }),
        },
      }),
    }, dependencies.inventoryReadPort, dependencies.stockCheckRepository, {
      now: dependencies.now,
      generateId: () => dependencies.generateId("stock-check"),
    });
    sendJson(response, 200, result);
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
    const publicationKey = `${businessId}:${quoteRequestId}`;
    let publication = deliveryState.publishing.get(publicationKey);
    if (publication === undefined) {
      publication = (async () => {
        const publication = await publishPublishedQuoteAtomically({ businessId, quoteRequestId }, dependencies);
        const result = publication.result;
        const delivery = await deliverPublishedQuote({
          businessId,
          messageId: result.messageId,
          quoteRequestId,
          conversationId: result.conversationId,
          channel: result.channel,
          content: result.content,
          outboundDeliveryId: publication.outboundDeliveryId,
        }, dependencies, deliveryState);
        return { result, delivery };
      })();
      deliveryState.publishing.set(publicationKey, publication);
    }
    let result: AtomicPublishedQuote["result"];
    let delivery: PublishedQuoteDelivery;
    try {
      ({ result, delivery } = await publication);
    } finally {
      if (deliveryState.publishing.get(publicationKey) === publication) {
        deliveryState.publishing.delete(publicationKey);
      }
    }
    const deliveryFailed = delivery.status === "FAILED" || delivery.status === "SENDING" || delivery.status === "RECIPIENT_NOT_FOUND" || (
      delivery.status === "NOT_CONFIGURED" && result.channel === Channel.WHATSAPP
    );
    sendJson(response, deliveryFailed ? 503 : 200, { ...result, delivery });
    return;
  }

  sendError(response, 404, "Not found");
}

export async function handleAdminRequest(url: URL, request: IncomingMessage, response: ServerResponse, dependencies: AdminHttpServerDependencies): Promise<void> {
  if (request.method !== "GET" || !dependencies.adminQueryService || !dependencies.adminBusinessScopeAuthorizer) {
    sendError(response, 404, "Not found");
    return;
  }
  const businessId = url.searchParams.get("businessId")?.trim();
  if (!businessId) {
    sendError(response, 400, "businessId is required");
    return;
  }
  if (!(await dependencies.adminBusinessScopeAuthorizer.isAuthorized({ businessId }))) {
    sendError(response, 403, "Forbidden");
    return;
  }

  if (url.pathname === "/v1/admin/overview") {
    let period;
    let channel;
    try {
      period = parseAdminPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
      channel = optionalEnumQuery(url.searchParams.get("channel"), Object.values(Channel));
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : "Invalid query");
      return;
    }
    const overview = await dependencies.adminQueryService.getOverview({ businessId, period, ...(channel === undefined ? {} : { channel }) });
    sendJson(response, 200, overview);
    return;
  }

  if (url.pathname === "/v1/admin/demand") {
    let period;
    let channel;
    let year: number | undefined;
    try {
      period = parseAdminPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
      channel = optionalEnumQuery(url.searchParams.get("channel"), Object.values(Channel));
      const yearValue = url.searchParams.get("year");
      year = yearValue === null ? undefined : Number(yearValue);
      if (year !== undefined && (!Number.isInteger(year) || year < 0)) throw new Error("Invalid year");
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : "Invalid query");
      return;
    }
    const serviceItem = url.searchParams.get("service") ?? url.searchParams.get("item");
    const demand = await dependencies.adminQueryService.getDemand({
      businessId, period,
      ...(channel === undefined ? {} : { channel }),
      ...(serviceItem === null ? {} : { serviceItem }),
      ...(url.searchParams.get("brand") === null ? {} : { brand: url.searchParams.get("brand")! }),
      ...(url.searchParams.get("model") === null ? {} : { model: url.searchParams.get("model")! }),
      ...(year === undefined ? {} : { year }),
    });
    sendJson(response, 200, demand);
    return;
  }

  if (url.pathname === "/v1/admin/inventory") {
    let period;
    let availability;
    try {
      period = parseAdminPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
      availability = optionalEnumQuery(url.searchParams.get("availability"), Object.values(InventoryAvailability));
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : "Invalid query");
      return;
    }
    const requestedItem = url.searchParams.get("service") ?? url.searchParams.get("item");
    const inventory = await dependencies.adminQueryService.getInventory({
      businessId,
      period,
      ...(availability === undefined ? {} : { availability }),
      ...(requestedItem === null ? {} : { requestedItem }),
    });
    sendJson(response, 200, inventory);
    return;
  }

  if (url.pathname === "/v1/admin/conversations") {
    let pagination;
    let period;
    let channel;
    let status;
    let intent;
    let year: number | undefined;
    let serviceItem: string | undefined;
    try {
      pagination = parseAdminPagination(url.searchParams.get("page") ?? undefined, url.searchParams.get("pageSize") ?? undefined);
      period = parseAdminPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
      channel = optionalEnumQuery(url.searchParams.get("channel"), Object.values(Channel));
      status = optionalEnumQuery(url.searchParams.get("status"), Object.values(ConversationStatus));
      intent = optionalEnumQuery(url.searchParams.get("intent"), Object.values(Intent));
      const yearValue = url.searchParams.get("year");
      year = yearValue === null ? undefined : Number(yearValue);
      if (year !== undefined && (!Number.isInteger(year) || year < 0)) throw new Error("Invalid year");
      serviceItem = url.searchParams.get("service") ?? url.searchParams.get("item") ?? undefined;
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : "Invalid query");
      return;
    }
    const result = await dependencies.adminQueryService.listConversations({ businessId, period, ...pagination, ...(channel === undefined ? {} : { channel }), ...(status === undefined ? {} : { status }), ...(intent === undefined ? {} : { intent }), ...(serviceItem === undefined ? {} : { serviceItem }), ...(url.searchParams.get("brand") === null ? {} : { brand: url.searchParams.get("brand")! }), ...(url.searchParams.get("model") === null ? {} : { model: url.searchParams.get("model")! }), ...(year === undefined ? {} : { year }) });
    sendJson(response, 200, result);
    return;
  }

  const detailMatch = url.pathname.match(/^\/v1\/admin\/conversations\/([^/]+)$/);
  if (detailMatch) {
    const conversationId = decodePathPart(detailMatch[1]);
    if (conversationId === null) {
      sendError(response, 400, "Invalid conversationId");
      return;
    }
    const detail = await dependencies.adminQueryService.getConversation({ businessId, conversationId });
    if (detail === null) {
      sendError(response, 404, "Conversation not found");
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  sendError(response, 404, "Not found");
}

function optionalEnumQuery<T extends string>(value: string | null, values: readonly T[]): T | undefined {
  if (value === null) return undefined;
  if (!values.includes(value as T)) throw new Error("Invalid filter");
  return value as T;
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
