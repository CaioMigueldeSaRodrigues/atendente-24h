import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AppointmentRepository, CommercialEventRepository, ConversationRepository, CustomerRepository, HumanHandoffRepository, MessageRepository, OpportunityRepository, OutboundDeliveryRepository, QuoteDraftRepository, QuoteRequestRepository, StockCheckRepository, VehicleRepository } from "../../core/repositories.js";
import type { MessageInterpreter } from "../../core/message-interpreter.js";
import { Channel, ConversationStatus, Intent, InventoryAvailability, OutboundDeliveryStatus, QuoteRequestStatus } from "../../core/domain/enums.js";
import type { Channel as ChannelType } from "../../core/domain/enums.js";
import type { Conversation } from "../../core/domain/entities.js";
import { processMessage } from "../../core/process-message.js";
import { respondToQuote } from "../../core/respond-to-quote.js";
import { confirmAppointment, ConfirmAppointmentError } from "../../core/confirm-appointment.js";
import { publishAuthorizedQuote } from "../../core/publish-authorized-quote.js";
import { outboundDeliveryLeaseUntil } from "../../core/outbound-delivery-policy.js";
import { parseEvolutionGoInboundText } from "../../channels/whatsapp/evolution-go-message-parser.js";
import { parseEvolutionGoReceipt } from "../../channels/whatsapp/evolution-go-receipt-parser.js";
import {
  authenticateEvolutionGoWebhook,
  type EvolutionGoWebhookCredential,
} from "../../channels/whatsapp/evolution-go-webhook-auth.js";
import type { EvolutionGoWebhookReplayGuard } from "../../channels/whatsapp/evolution-go-webhook-replay-guard.js";
import type { EvolutionGoConversationLinkRepository } from "../../channels/whatsapp/evolution-go-conversation-link.js";
import { maskEvolutionGoContact } from "../../channels/whatsapp/masked-contact.js";
import type { EvolutionGoTextMessage } from "../../channels/whatsapp/evolution-go-text-sender.js";
import type { EvolutionGoWebhookTransaction } from "../../channels/whatsapp/evolution-go-webhook-transaction.js";
import type { ChannelTextSender } from "../../channels/channel-text-sender.js";
import { resolveEvolutionGoConversation } from "../../channels/whatsapp/evolution-go-conversation-resolver.js";
import { renderBasicPlanOperatorUi, type BasicPlanOperatorConfig } from "./basic-plan-operator-ui.js";
import type { AdminBusinessScopeAuthorizer, AdminQueryService } from "../../core/admin-read-model.js";
import { parseAdminPagination, parseAdminPeriod } from "../../core/admin-read-model.js";
import { AdminPlan, type AdminPlan as AdminPlanType } from "../../core/admin-plan-entitlement.js";
import type { PlatformFilters, PlatformQueryService, SuperAdminAuthorizer } from "../../core/platform-admin-read-model.js";
import { checkInventory } from "../../core/check-inventory.js";
import type { InventoryReadPort } from "../../core/inventory-read-port.js";
import type { ProductPriceReadPort } from "../../core/product-price-read-port.js";
import type { LaborPriceReadPort } from "../../core/labor-price-read-port.js";
import type { BusinessCapabilities, BusinessCapabilityPolicy, IntegrationProviderAvailability } from "../../core/business-capability-policy.js";
import { authorizeQuoteDraft } from "../../core/authorize-quote-draft.js";
import { buildQuoteDraft, QuoteDraftError, type LaborDraftInput, type ProductDraftInput } from "../../core/build-quote-draft.js";
import type { QuotePersistenceTransaction } from "../../core/quote-persistence-transaction.js";
import type { BusinessOperatorAuthorizer } from "../../core/business-operator-authorizer.js";
import { QuoteDraftStatus } from "../../core/quote-draft.js";
import { isQuoteOperatorActionable } from "../../core/quote-actionability.js";

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
  appointmentConfirming: Map<string, Promise<AppointmentConfirmation>>;
};

type AppointmentConfirmation = Awaited<ReturnType<typeof confirmAppointment>> & {
  deliveryResult: PublishedQuoteDelivery;
};

type PublishedQuoteDeliveryInput = {
  businessId: string;
  messageId: string;
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
  quoteDraftRepository?: QuoteDraftRepository;
  quoteTransaction?: QuotePersistenceTransaction;
  productPriceReadPort?: ProductPriceReadPort;
  laborPriceReadPort?: LaborPriceReadPort;
  businessCapabilityPolicy?: BusinessCapabilityPolicy;
  businessOperatorAuthorizer: BusinessOperatorAuthorizer;
  integrationProviderAvailability?: IntegrationProviderAvailability;
  commercialEventRepository?: CommercialEventRepository;
  evolutionGoWebhookCredentials?: EvolutionGoWebhookCredential[];
  evolutionGoWebhookReplayGuard?: EvolutionGoWebhookReplayGuard;
  evolutionGoConversationLinkRepository?: EvolutionGoConversationLinkRepository;
  evolutionGoTextSender?: { sendText(message: EvolutionGoTextMessage): Promise<void | { providerMessageId: string }> };
  channelTextSenders?: Partial<Record<ChannelType, ChannelTextSender>>;
  adminQueryService?: AdminQueryService;
  adminBusinessScopeAuthorizer?: AdminBusinessScopeAuthorizer;
  platformQueryService?: PlatformQueryService;
  superAdminAuthorizer?: SuperAdminAuthorizer;
  evolutionGoWebhookTransaction: EvolutionGoWebhookTransaction;
  operator: BasicPlanOperatorConfig;
  interpreter: MessageInterpreter;
  operationalLog?: (event: BasicPlanOperationalEvent) => void;
  now: () => string;
  generateId: (prefix: string) => string;
};

export type BasicPlanOperationalEvent =
  | "WEBHOOK Message accepted"
  | "WEBHOOK stale message ignored"
  | "LLM completed"
  | "Evolution send accepted"
  | "Receipt DELIVERED applied"
  | "Receipt READ applied"
  | "Webhook error receipt_apply"
  | "QUOTE publish requested"
  | "QUOTE authorization loaded"
  | "QUOTE conversation loaded"
  | "QUOTE recipient resolved"
  | "QUOTE publication transaction started"
  | "QUOTE publication persisted"
  | "Outbound delivery reserved"
  | "QUOTE publication transaction committed"
  | `QUOTE publish error ${QuotePublishErrorCategory}`;

export type QuotePublishErrorCategory =
  | "quote_request_load"
  | "conversation_load"
  | "recipient_resolution"
  | "publication_transaction"
  | "draft_validation"
  | "outbound_reservation"
  | "publication_persistence"
  | "outbound_attach"
  | "draft_state";

export type AdminHttpServerDependencies = Pick<
  BasicPlanHttpServerDependencies,
  "adminQueryService" | "adminBusinessScopeAuthorizer" | "platformQueryService" | "superAdminAuthorizer"
>;

export function createBasicPlanHttpServer(
  dependencies: BasicPlanHttpServerDependencies,
): Server {
  const deliveryState: PublishedQuoteDeliveryState = {
    inFlight: new Map(),
    publishing: new Map(),
    appointmentConfirming: new Map(),
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

    let recipientRef = currentDelivery.recipientRef;
    if (recipientRef === undefined) {
      const recipient = await resolveDeliveryRecipient(input, dependencies);
      if (recipient.recipientRef === undefined) {
        const retryable = recipient.retryable;
        await repository.markFailed(input.businessId, currentDelivery.id, {
          status: retryable ? OutboundDeliveryStatus.FAILED_RETRYABLE : OutboundDeliveryStatus.FAILED_FINAL,
          lastError: recipient.retryable ? RECIPIENT_REPOSITORY_NOT_CONFIGURED : RECIPIENT_NOT_FOUND,
          ...(retryable ? { nextAttemptAt: dependencies.now() } : {}),
          updatedAt: dependencies.now(),
        }, claim.delivery.claimToken!);
        return { status: "RECIPIENT_NOT_FOUND", retryable };
      }
      recipientRef = recipient.recipientRef;
    }

    let sendResult: void | { providerMessageId: string };
    try {
      sendResult = await sender.sendText({ recipientJid: recipientRef, content: input.content });
    } catch (cause) {
      await repository.markFailed(input.businessId, currentDelivery.id, {
        status: OutboundDeliveryStatus.FAILED_RETRYABLE,
        lastError: errorMessage(cause),
        nextAttemptAt: dependencies.now(),
        updatedAt: dependencies.now(),
      }, claim.delivery.claimToken!);
      return { status: "FAILED", retryable: true };
    }

    emitOperationalEvent(dependencies, "Evolution send accepted");
    const providerMessageId = sendResult && "providerMessageId" in sendResult
      ? sendResult.providerMessageId
      : undefined;
    await repository.markDelivered(
      input.businessId,
      currentDelivery.id,
      dependencies.now(),
      dependencies.now(),
      claim.delivery.claimToken!,
      providerMessageId,
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

async function resolveOperatorContactLabel(
  businessId: string,
  conversation: Conversation | null,
  linkRepository: EvolutionGoConversationLinkRepository | undefined,
): Promise<string | undefined> {
  if (conversation?.channel !== Channel.WHATSAPP) return undefined;
  if (!linkRepository) return "WhatsApp";
  try {
    const link = await linkRepository.findByConversation(businessId, conversation.id);
    return link === null ? "WhatsApp" : maskEvolutionGoContact(link.senderJid);
  } catch {
    return "WhatsApp";
  }
}

type AtomicPublishedQuote = {
  result: Awaited<ReturnType<typeof publishAuthorizedQuote>>;
  outboundDeliveryId: string;
};

type QuotePublicationLog = {
  event: (event: BasicPlanOperationalEvent) => void;
  error: (category: QuotePublishErrorCategory) => void;
};

function createQuotePublicationLog(dependencies: BasicPlanHttpServerDependencies): QuotePublicationLog {
  let errorLogged = false;
  return {
    event: (event) => emitOperationalEvent(dependencies, event),
    error: (category) => {
      if (errorLogged) return;
      errorLogged = true;
      emitOperationalEvent(dependencies, `QUOTE publish error ${category}`);
    },
  };
}

async function publishPublishedQuoteAtomically(
  input: { businessId: string; quoteRequestId: string },
  dependencies: BasicPlanHttpServerDependencies,
  publicationLog: QuotePublicationLog,
): Promise<AtomicPublishedQuote> {
  let stage: QuotePublishErrorCategory = "quote_request_load";
  try {
    const quote = await dependencies.quoteRequestRepository.findById(input.businessId, input.quoteRequestId);
    if (quote === null) throw new Error("QuoteRequest not found");
    publicationLog.event("QUOTE authorization loaded");

    stage = "conversation_load";
    const conversation = await dependencies.conversationRepository.findById(input.businessId, quote.conversationId);
    if (conversation === null) throw new Error("Conversation not found");
    publicationLog.event("QUOTE conversation loaded");

    stage = "recipient_resolution";
    const recipient = await resolveDeliveryRecipient({
      businessId: input.businessId,
      conversationId: conversation.id,
      channel: conversation.channel,
    }, dependencies);
    publicationLog.event("QUOTE recipient resolved");

    const publish = async () => {
      stage = "quote_request_load";
      const currentQuote = await dependencies.quoteRequestRepository.findById(input.businessId, input.quoteRequestId);
      if (!currentQuote) throw new Error("QuoteRequest not found");
      stage = "draft_validation";
      const draft = await dependencies.quoteDraftRepository?.findLatestByQuoteRequest(input.businessId, input.quoteRequestId);
      if (draft && (![QuoteDraftStatus.APPROVED, QuoteDraftStatus.PUBLISHED].includes(draft.status) || currentQuote.authorizedPrice?.amountCents !== draft.total.amountCents || currentQuote.authorizedPrice.currency !== draft.total.currency)) throw new QuoteDraftError("DRAFT_NOT_APPROVABLE");
      stage = "publication_transaction";
      return dependencies.evolutionGoWebhookTransaction.run(async () => {
        publicationLog.event("QUOTE publication transaction started");
        const now = dependencies.now();
        stage = "outbound_reservation";
        const existingDelivery = await dependencies.outboundDeliveryRepository.findByQuoteRequestAndChannel(input.businessId, quote.id, conversation.channel);
        // A published snapshot can only reuse its persisted publication, never create another.
        if (draft?.status === QuoteDraftStatus.PUBLISHED && existingDelivery === null) throw new QuoteDraftError("DRAFT_NOT_APPROVABLE");
        const reservation = existingDelivery === null ? await dependencies.outboundDeliveryRepository.reserve({
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
        }) : { created: false, delivery: existingDelivery };
        if (reservation.created) publicationLog.event("Outbound delivery reserved");
        if (!reservation.created) {
          if (reservation.delivery.messageId === undefined) throw new Error("OutboundDelivery has no published message");
          const messages = await dependencies.messageRepository.listByConversation(input.businessId, conversation.id);
          const message = messages.find((candidate) => candidate.id === reservation.delivery.messageId);
          if (message === undefined) throw new Error("Published Message not found");
          stage = "draft_state";
          await markIntegratedDraftPublished(input.businessId, input.quoteRequestId, dependencies);
          stage = "publication_transaction";
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
        stage = "publication_persistence";
        const result = await publishAuthorizedQuote(
          { businessId: input.businessId, quoteRequestId: input.quoteRequestId },
          { ...dependencies, strictCommercialEventPersistence: true },
        );
        publicationLog.event("QUOTE publication persisted");
        stage = "outbound_attach";
        await dependencies.outboundDeliveryRepository.attachMessage(input.businessId, reservation.delivery.id, result.messageId, dependencies.now());
        stage = "draft_state";
        await markIntegratedDraftPublished(input.businessId, input.quoteRequestId, dependencies);
        stage = "publication_transaction";
        return { result, outboundDeliveryId: reservation.delivery.id };
      });
    };
    const publication = dependencies.quoteTransaction ? await dependencies.quoteTransaction.run(input.businessId, input.quoteRequestId, publish) : await publish();
    publicationLog.event("QUOTE publication transaction committed");
    return publication;
  } catch (cause) {
    publicationLog.error(classifyQuotePublishError(stage, cause));
    throw cause;
  }
}

function classifyQuotePublishError(stage: QuotePublishErrorCategory, cause: unknown): QuotePublishErrorCategory {
  if (cause instanceof QuoteDraftError) return "draft_validation";
  if (stage === "quote_request_load" && cause instanceof Error && cause.message === "QuoteRequest not found") return "quote_request_load";
  if (stage === "conversation_load" && cause instanceof Error && cause.message === "Conversation not found") return "conversation_load";
  return stage;
}

async function markIntegratedDraftPublished(businessId: string, quoteRequestId: string, dependencies: BasicPlanHttpServerDependencies): Promise<void> {
  const draft = await dependencies.quoteDraftRepository?.findLatestByQuoteRequest(businessId, quoteRequestId);
  if (!draft) return; // The existing manual flow has no integrated draft.
  if (draft.status !== QuoteDraftStatus.APPROVED && draft.status !== QuoteDraftStatus.PUBLISHED) throw new QuoteDraftError("DRAFT_NOT_APPROVABLE");
  await dependencies.quoteDraftRepository!.markPublished(businessId, draft.id, dependencies.now());
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

  setSecurityHeaders(response);

  if (request.method === "GET" && pathname === "/operator") {
    if (!(await isOperatorAuthorized(request, dependencies.operator.businessId, dependencies))) {
      response.setHeader("WWW-Authenticate", 'Basic realm="Ampliview operator", charset="UTF-8"');
      sendError(response, 401, "Unauthorized");
      return;
    }
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

  const capabilityMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/capabilities$/);
  if (request.method === "GET" && capabilityMatch) {
    const businessId = decodePathPart(capabilityMatch[1]);
    if (businessId === null) { sendError(response, 400, "Invalid path"); return; }
    if (!(await isOperatorAuthorized(request, businessId, dependencies))) { sendError(response, 404, "Not found"); return; }
    const capabilities = await getBusinessCapabilities(businessId, dependencies);
    sendJson(response, 200, capabilities);
    return;
  }

  const draftAuthorizeMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/quotes\/([^/]+)\/draft\/authorize$/);
  if (request.method === "POST" && draftAuthorizeMatch) {
    const businessId = decodePathPart(draftAuthorizeMatch[1]);
    const quoteRequestId = decodePathPart(draftAuthorizeMatch[2]);
    if (businessId === null || quoteRequestId === null) { sendError(response, 400, "Invalid path"); return; }
    if (!(await isOperatorAuthorized(request, businessId, dependencies))) { sendError(response, 404, "Not found"); return; }
    const capabilities = await getBusinessCapabilities(businessId, dependencies);
    const gateError = integratedQuoteGateError(capabilities);
    if (gateError) { sendError(response, gateError.status, gateError.message); return; }
    if (!dependencies.quoteDraftRepository || !dependencies.quoteTransaction) { sendError(response, 503, "Quote persistence is not configured"); return; }
    if (request.headers["content-length"] === "0") { sendError(response, 400, "INVALID_DRAFT_REFERENCE"); return; }
    const body = await readJsonBody(request, response); if (body === undefined) return;
    const expected = parseExpectedDraft(body); if (expected === null) { sendError(response, 400, "INVALID_DRAFT_REFERENCE"); return; }
    const draft = await authorizeQuoteDraft({ businessId, quoteRequestId, expectedDraftId: expected.draftId, expectedRevision: expected.revision }, { quoteDraftRepository: dependencies.quoteDraftRepository, quoteTransaction: dependencies.quoteTransaction, quoteRequestRepository: dependencies.quoteRequestRepository, opportunityRepository: dependencies.opportunityRepository, ...(dependencies.commercialEventRepository ? { commercialEventRepository: dependencies.commercialEventRepository } : {}), now: dependencies.now, generateId: dependencies.generateId });
    sendJson(response, 200, draft);
    return;
  }

  const draftMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/quotes\/([^/]+)\/draft$/);
  if (draftMatch && (request.method === "GET" || request.method === "POST")) {
    const businessId = decodePathPart(draftMatch[1]);
    const quoteRequestId = decodePathPart(draftMatch[2]);
    if (businessId === null || quoteRequestId === null) { sendError(response, 400, "Invalid path"); return; }
    if (!(await isOperatorAuthorized(request, businessId, dependencies))) { sendError(response, 404, "Not found"); return; }
    const capabilities = await getBusinessCapabilities(businessId, dependencies);
    const gateError = integratedQuoteGateError(capabilities);
    if (gateError) { sendError(response, gateError.status, gateError.message); return; }
    if (!dependencies.quoteDraftRepository || !dependencies.quoteTransaction) { sendError(response, 503, "Quote persistence is not configured"); return; }
    if (request.method === "GET") {
      const draft = await dependencies.quoteDraftRepository.findLatestByQuoteRequest(businessId, quoteRequestId);
      if (!draft) { sendError(response, 404, "QuoteDraft not found"); return; }
      sendJson(response, 200, draft);
      return;
    }
    const body = await readJsonBody(request, response);
    if (body === undefined) return;
    const parsedValue = parseDraftBody(body);
    const parsed = parsedValue === null ? null : { products: parsedValue.products.map((product) => ({ ...product, quantitySource: "OPERATOR_CONFIRMED" as const })), labor: parsedValue.labor.map((labor) => ({ ...labor, quantitySource: "OPERATOR_CONFIRMED" as const })) };
    if (parsed === null) { sendError(response, 400, "Invalid quote draft lines"); return; }
    if (!dependencies.inventoryReadPort || !dependencies.stockCheckRepository || !dependencies.productPriceReadPort || !dependencies.laborPriceReadPort) { sendError(response, 503, "Integrated quote providers are not configured"); return; }
    const draft = await buildQuoteDraft({ businessId, quoteRequestId, ...parsed }, { quoteRequestRepository: dependencies.quoteRequestRepository, stockCheckRepository: dependencies.stockCheckRepository, inventoryReadPort: dependencies.inventoryReadPort, productPriceReadPort: dependencies.productPriceReadPort, laborPriceReadPort: dependencies.laborPriceReadPort, quoteDraftRepository: dependencies.quoteDraftRepository, quoteTransaction: dependencies.quoteTransaction, now: dependencies.now, generateId: dependencies.generateId });
    sendJson(response, 201, draft);
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
    const receipt = parseEvolutionGoReceipt(payload);
    if (receipt !== null) {
      const replayGuard = dependencies.evolutionGoWebhookReplayGuard;
      if (!replayGuard) {
        sendError(response, 503, "Service unavailable");
        return;
      }
      try {
        await replayGuard.applyProviderReceipt({
          businessId: authenticatedWebhook.businessId,
          instanceName: authenticatedWebhook.instanceName,
          providerMessageId: receipt.providerMessageId,
          status: receipt.status,
          occurredAt: receipt.occurredAt,
        });
      } catch (cause) {
        emitOperationalEvent(dependencies, "Webhook error receipt_apply");
        throw cause;
      }
      emitOperationalEvent(dependencies, receipt.status === "DELIVERED" ? "Receipt DELIVERED applied" : "Receipt READ applied");
      sendJson(response, 202, { accepted: true, reason: "provider_receipt" });
      return;
    }
    const message = parseEvolutionGoInboundText(payload);
    if (message === null) {
      sendJson(response, 202, { accepted: false, reason: "ignored_event" });
      return;
    }
    const receivedAt = dependencies.now();
    if (isStaleEvolutionGoInboundMessage(message.occurredAt, receivedAt)) {
      emitOperationalEvent(dependencies, "WEBHOOK stale message ignored");
      sendJson(response, 202, { accepted: false, reason: "stale_message" });
      return;
    }
    emitOperationalEvent(dependencies, "WEBHOOK Message accepted");
    const replayGuard = dependencies.evolutionGoWebhookReplayGuard;
    const linkRepository = dependencies.evolutionGoConversationLinkRepository;
    const textSender = dependencies.evolutionGoTextSender;
    if (!replayGuard || !linkRepository || !textSender) {
      sendError(response, 503, "Service unavailable");
      return;
    }
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
          emitOperationalEvent(dependencies, "LLM completed");
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

    let sendResult: void | { providerMessageId: string };
    try {
      sendResult = await textSender.sendText({
        recipientJid: processed.senderJid,
        content: processed.reply,
      });
    } catch {
      sendError(response, 503, "Service unavailable");
      return;
    }
    emitOperationalEvent(dependencies, "Evolution send accepted");
    const sent = await replayGuard.markSent({
      businessId: authenticatedWebhook.businessId,
      instanceName: authenticatedWebhook.instanceName,
      externalMessageId: message.externalMessageId,
      sentAt: dependencies.now(),
      ...(sendResult && "providerMessageId" in sendResult ? { providerMessageId: sendResult.providerMessageId } : {}),
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
    if (businessId !== dependencies.operator.businessId) {
      sendError(response, 404, "Not found");
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
      if (!(await isOperatorAuthorized(request, businessId, dependencies))) {
        sendError(response, 404, "Not found");
        return;
      }
      const messages = await dependencies.messageRepository.listByConversation(businessId, conversationId);
      sendJson(response, 200, { messages });
      return;
    }
    if (request.method === "POST") {
      if (businessId !== dependencies.operator.businessId) {
        sendError(response, 404, "Not found");
        return;
      }
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
    if (!(await isOperatorAuthorized(request, businessId, dependencies))) { sendError(response, 404, "Not found"); return; }
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
    if (!(await isOperatorAuthorized(request, businessId, dependencies))) { sendError(response, 404, "Not found"); return; }
    const pendingStatuses = new Set([
      QuoteRequestStatus.REQUESTED,
      QuoteRequestStatus.WAITING_INFORMATION,
      QuoteRequestStatus.WAITING_BUSINESS,
      QuoteRequestStatus.RESPONDED,
    ]);
    const quotes = (await dependencies.quoteRequestRepository.listByBusiness(businessId)).filter((quote) => pendingStatuses.has(quote.status));
    const items = (await Promise.all(quotes.map(async (quote) => {
      const [customer, vehicle, conversation] = await Promise.all([
        quote.customerId === undefined
          ? Promise.resolve(null)
          : dependencies.customerRepository.findById(businessId, quote.customerId),
        quote.vehicleId === undefined
          ? Promise.resolve(null)
          : dependencies.vehicleRepository.findById(businessId, quote.vehicleId),
        dependencies.conversationRepository.findById(businessId, quote.conversationId),
      ]);
      const draft = await dependencies.quoteDraftRepository?.findLatestByQuoteRequest(businessId, quote.id);
      const appointments = conversation === null
        ? []
        : await dependencies.appointmentRepository.listByConversation(businessId, conversation.id);
      const appointment = appointments
        .filter((candidate) =>
          (candidate.status === "REQUESTED" || candidate.status === "CONFIRMED") &&
          candidate.opportunityId === quote.opportunityId,
        )
        .at(-1) ?? null;
      const [delivery, appointmentDelivery] = await Promise.all([
        conversation === null
          ? Promise.resolve(null)
          : dependencies.outboundDeliveryRepository.findByQuoteRequestAndChannel(businessId, quote.id, conversation.channel),
        appointment === null || conversation === null
          ? Promise.resolve(null)
          : dependencies.outboundDeliveryRepository.findByAppointmentAndChannel(businessId, appointment.id, conversation.channel),
      ]);
      const contactLabel = await resolveOperatorContactLabel(businessId, conversation, dependencies.evolutionGoConversationLinkRepository);
      const operatorCustomer = customer === null ? null : {
        id: customer.id,
        businessId: customer.businessId,
        ...(customer.name === undefined ? {} : { name: customer.name }),
        ...(customer.email === undefined ? {} : { email: customer.email }),
      };
      const operatorDelivery = delivery === null ? null : { status: delivery.status };
      const quoteActionable = isQuoteOperatorActionable(quote.status, delivery?.status);
      return quoteActionable || appointment !== null
        ? {
            quote,
            customer: operatorCustomer,
            vehicle,
            conversation,
            ...(contactLabel === undefined ? {} : { contactLabel }),
            draft: draft ?? null,
            delivery: operatorDelivery,
            quoteActionable,
            appointment,
            appointmentDelivery: appointmentDelivery === null
              ? null
              : { status: appointmentDelivery.status, ...(appointmentDelivery.providerMessageId === undefined ? {} : { providerMessageId: appointmentDelivery.providerMessageId }) },
          }
        : null;
    }))).filter((item): item is NonNullable<typeof item> => item !== null);
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
    if (!(await isOperatorAuthorized(request, businessId, dependencies))) { sendError(response, 404, "Not found"); return; }
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
    const capabilities = await getBusinessCapabilities(businessId, dependencies);
    const inventoryPort = !dependencies.businessCapabilityPolicy || !capabilities.capabilities.canUseInventoryInAssistant
      ? { check: async () => ({ availability: InventoryAvailability.UNKNOWN, source: "provider-unavailable" }) }
      : dependencies.inventoryReadPort;
    if (!inventoryPort) { sendError(response, 503, "Inventory provider is not configured"); return; }
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
    }, inventoryPort, dependencies.stockCheckRepository, {
      now: dependencies.now,
      generateId: () => dependencies.generateId("stock-check"),
    });
    sendJson(response, 200, result);
    return;
  }

  const appointmentConfirmMatch = pathname.match(/^\/v1\/businesses\/([^/]+)\/appointments\/([^/]+)\/confirm$/);
  if (request.method === "POST" && appointmentConfirmMatch) {
    const businessId = decodePathPart(appointmentConfirmMatch[1]);
    const appointmentId = decodePathPart(appointmentConfirmMatch[2]);
    if (businessId === null || appointmentId === null) { sendError(response, 400, "Invalid path"); return; }
    if (!(await isOperatorAuthorized(request, businessId, dependencies))) { sendError(response, 404, "Not found"); return; }
    const body = await readJsonBody(request, response);
    if (body === undefined) return;
    const parsed = parseAppointmentConfirmationBody(body);
    if (parsed === null) { sendError(response, 400, "Invalid appointment confirmation"); return; }
    const key = `${businessId}:${appointmentId}`;
    let confirmation = deliveryState.appointmentConfirming.get(key);
    if (confirmation === undefined) {
      confirmation = (async () => {
        const saved = await dependencies.evolutionGoWebhookTransaction.run(() => confirmAppointment({
          businessId,
          appointmentId,
          ...parsed,
        }, {
          appointmentRepository: dependencies.appointmentRepository,
          conversationRepository: dependencies.conversationRepository,
          quoteRequestRepository: dependencies.quoteRequestRepository,
          messageRepository: dependencies.messageRepository,
          outboundDeliveryRepository: dependencies.outboundDeliveryRepository,
          ...(dependencies.commercialEventRepository ? { commercialEventRepository: dependencies.commercialEventRepository } : {}),
          now: dependencies.now,
          generateId: dependencies.generateId,
        }));
        const deliveryResult = await deliverPublishedQuote({
          businessId,
          messageId: saved.messageId!,
          conversationId: saved.appointment!.conversationId,
          channel: saved.delivery.channel,
          content: saved.content,
          outboundDeliveryId: saved.delivery.id,
        }, dependencies, deliveryState);
        return { ...saved, deliveryResult };
      })();
      deliveryState.appointmentConfirming.set(key, confirmation);
    }
    try {
      const result = await confirmation;
      const deliveryFailed = result.deliveryResult.status === "FAILED" || result.deliveryResult.status === "SENDING" || result.deliveryResult.status === "RECIPIENT_NOT_FOUND" || (result.deliveryResult.status === "NOT_CONFIGURED" && result.deliveryResult.retryable);
      sendJson(response, deliveryFailed ? 503 : 200, { ...result, delivery: result.deliveryResult });
    } finally {
      if (deliveryState.appointmentConfirming.get(key) === confirmation) deliveryState.appointmentConfirming.delete(key);
    }
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
    if (!(await isOperatorAuthorized(request, businessId, dependencies))) { sendError(response, 404, "Not found"); return; }
    if (quoteActionMatch[3] === "respond") {
      const body = await readJsonBody(request, response);
      if (body === undefined) return;
      if (!isRecord(body) || typeof body.amountCents !== "number" || !Number.isSafeInteger(body.amountCents) || body.amountCents < 0 || body.currency !== "BRL") {
        sendError(response, 400, "Invalid authorized price");
        return;
      }
      const amountCents = body.amountCents;
      const operation = async () => {
        const draft = await dependencies.quoteDraftRepository?.findLatestByQuoteRequest(businessId, quoteRequestId);
        if (draft && [QuoteDraftStatus.PENDING_APPROVAL, QuoteDraftStatus.APPROVED, QuoteDraftStatus.PUBLISHED].includes(draft.status)) throw new QuoteDraftError("MANUAL_QUOTE_CONFLICT");
        return respondToQuote({ businessId, quoteRequestId, authorizedPrice: { amountCents, currency: "BRL" } }, dependencies);
      };
      const result = dependencies.quoteTransaction ? await dependencies.quoteTransaction.run(businessId, quoteRequestId, operation) : await operation();
      sendJson(response, 200, result);
      return;
    }
    emitOperationalEvent(dependencies, "QUOTE publish requested");
    const publicationKey = `${businessId}:${quoteRequestId}`;
    let publication = deliveryState.publishing.get(publicationKey);
    if (publication === undefined) {
      publication = (async () => {
        const publicationLog = createQuotePublicationLog(dependencies);
        const publication = await publishPublishedQuoteAtomically({ businessId, quoteRequestId }, dependencies, publicationLog);
        const result = publication.result;
        const delivery = await deliverPublishedQuote({
          businessId,
          messageId: result.messageId,
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
  if (request.method !== "GET") {
    sendError(response, 404, "Not found");
    return;
  }

  const platformMatch = url.pathname.match(/^\/v1\/admin\/platform\/(overview|plans|health|issues)$/);
  if (platformMatch) {
    if (!dependencies.platformQueryService || !dependencies.superAdminAuthorizer || !(await dependencies.superAdminAuthorizer.isAuthorized())) {
      sendError(response, 403, "Super Admin authorization required");
      return;
    }
    let filters: PlatformFilters;
    try {
      const planValue = url.searchParams.get("plan");
      const plan = planValue === null ? undefined : optionalEnumQuery(planValue, Object.values(AdminPlan)) as AdminPlanType;
      const statusValue = url.searchParams.get("status");
      const status = statusValue === null ? undefined : optionalEnumQuery(statusValue, ["ACTIVE", "INACTIVE"] as const);
      const issueType = url.searchParams.get("issueType") ?? undefined;
      const businessId = url.searchParams.get("businessId")?.trim() || undefined;
      filters = { period: parseAdminPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined), ...(plan === undefined ? {} : { plan }), ...(businessId === undefined ? {} : { businessId }), ...(status === undefined ? {} : { status }), ...(issueType === undefined ? {} : { issueType }) };
      if (url.searchParams.has("region") || url.searchParams.has("state") || url.searchParams.has("city")) throw new Error("Location filters are not available");
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : "Invalid query");
      return;
    }
    const result = platformMatch[1] === "overview"
      ? await dependencies.platformQueryService.getOverview(filters)
      : platformMatch[1] === "plans"
        ? await dependencies.platformQueryService.getPlans(filters)
        : platformMatch[1] === "health"
          ? await dependencies.platformQueryService.getHealth(filters)
          : await dependencies.platformQueryService.getIssues(filters);
    sendJson(response, 200, result);
    return;
  }

  if (!dependencies.adminBusinessScopeAuthorizer) {
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

  if (!dependencies.adminQueryService) {
    sendError(response, 404, "Not found");
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
  if (cause instanceof QuoteDraftError) {
    const status = cause.code === "QUOTE_NOT_FOUND" ? 404 : cause.code === "CAPABILITY_REQUIRED" ? 403 : cause.code === "PRICE_UNAVAILABLE" ? 503 : ["DRAFT_IMMUTABLE", "DRAFT_NOT_APPROVABLE", "QUOTE_DRAFT_CONFLICT", "QUOTE_DRAFT_STALE", "MANUAL_QUOTE_CONFLICT"].includes(cause.code) ? 409 : 400;
    return { status, body: cause.code };
  }
  if (cause instanceof ConfirmAppointmentError) {
    const status = cause.code === "APPOINTMENT_NOT_FOUND" ? 404 : cause.code === "INVALID_APPOINTMENT_DATETIME" ? 400 : 409;
    return { status, body: cause.code };
  }
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

async function isOperatorAuthorized(request: IncomingMessage, businessId: string, dependencies: BasicPlanHttpServerDependencies): Promise<boolean> {
  const credential = request.headers.authorization;
  return dependencies.businessOperatorAuthorizer.isAuthorized({
    businessId,
    ...(credential === undefined ? {} : { credential }),
  });
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
}

function parseExpectedDraft(value: unknown): { draftId: string; revision: number } | null {
  if (!isRecord(value) || typeof value.draftId !== "string" || value.draftId.trim() === "" || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision <= 0) return null;
  return { draftId: value.draftId, revision: value.revision };
}

function parseAppointmentConfirmationBody(value: unknown): { conversationId: string; quoteRequestId: string; expectedAppointmentUpdatedAt: string; date: string; time: string } | null {
  if (!isRecord(value)) return null;
  if (typeof value.conversationId !== "string" || value.conversationId.trim() === "") return null;
  if (typeof value.quoteRequestId !== "string" || value.quoteRequestId.trim() === "") return null;
  if (typeof value.appointmentUpdatedAt !== "string" || value.appointmentUpdatedAt.trim() === "") return null;
  if (typeof value.date !== "string" || value.date.trim() === "") return null;
  if (typeof value.time !== "string" || value.time.trim() === "") return null;
  return {
    conversationId: value.conversationId,
    quoteRequestId: value.quoteRequestId,
    expectedAppointmentUpdatedAt: value.appointmentUpdatedAt,
    date: value.date,
    time: value.time,
  };
}

async function getBusinessCapabilities(businessId: string, dependencies: BasicPlanHttpServerDependencies): Promise<BusinessCapabilities> {
  if (dependencies.businessCapabilityPolicy) return dependencies.businessCapabilityPolicy.getCapabilities(businessId, dependencies.integrationProviderAvailability);
  return {
    businessId,
    plan: null,
    entitlements: { inventoryIntegration: false, productPricingIntegration: false, laborPricingIntegration: false },
    settings: { inventoryForAssistantEnabled: false, productPricingForAssistantEnabled: false, laborPricingForAssistantEnabled: false },
    providerAvailability: { inventory: "PROVIDER_UNAVAILABLE", productPricing: "PROVIDER_UNAVAILABLE", laborPricing: "PROVIDER_UNAVAILABLE" },
    capabilities: { canUseInventoryInAssistant: false, canUseProductPricingInAssistant: false, canUseLaborPricingInAssistant: false, canBuildIntegratedQuote: false },
    canBuildIntegratedQuote: false,
  };
}

function integratedQuoteGateError(capabilities: BusinessCapabilities): { status: number; message: string } | null {
  if (capabilities.canBuildIntegratedQuote) return null;
  if (!capabilities.entitlements.inventoryIntegration || !capabilities.entitlements.productPricingIntegration || !capabilities.entitlements.laborPricingIntegration) return { status: 403, message: "INTEGRATION_NOT_ENTITLED" };
  if (!capabilities.settings.inventoryForAssistantEnabled || !capabilities.settings.productPricingForAssistantEnabled || !capabilities.settings.laborPricingForAssistantEnabled) return { status: 403, message: "DISABLED_BY_BUSINESS" };
  return { status: 503, message: "PROVIDER_UNAVAILABLE" };
}

function parseDraftBody(value: unknown): { products: ProductDraftInput[]; labor: LaborDraftInput[] } | null {
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

const EVOLUTION_GO_INBOUND_MAX_AGE_MS = 15 * 60 * 1000;

function isStaleEvolutionGoInboundMessage(occurredAt: string, receivedAt: string): boolean {
  const occurredAtMs = parseEvolutionGoTimestamp(occurredAt);
  const receivedAtMs = Date.parse(receivedAt);
  if (occurredAtMs === null || !Number.isFinite(receivedAtMs)) return true;
  return receivedAtMs - occurredAtMs > EVOLUTION_GO_INBOUND_MAX_AGE_MS;
}

function parseEvolutionGoTimestamp(value: string): number | null {
  const dateValue = Date.parse(value);
  if (Number.isFinite(dateValue)) return dateValue;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  const milliseconds = Math.abs(numericValue) < 100_000_000_000
    ? numericValue * 1000
    : numericValue;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, statusCode: number, error: string): void {
  sendJson(response, statusCode, { error });
}

function emitOperationalEvent(
  dependencies: BasicPlanHttpServerDependencies,
  event: BasicPlanOperationalEvent,
): void {
  try {
    dependencies.operationalLog?.(event);
  } catch {
    // Operational logging must never change request behavior.
  }
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
