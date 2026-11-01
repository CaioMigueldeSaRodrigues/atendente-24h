import { requiresExplicitHumanHandoff, requiresTechnicalDiagnosisHandoff } from "./business-rules.js";
import { HANDOFF_REPLY, LLM_FAILURE_REPLY, LLM_LIMITED_REPLY, QUOTE_LOCKED_REPLY, UNSUPPORTED_MESSAGE_REPLY, resolveSafeReply } from "./response-policy.js";
import { getQuoteIntakeMissingData } from "./quote-intake-policy.js";
import type {
  Appointment,
  CommercialEvent,
  Conversation,
  Customer,
  HumanHandoff,
  Message,
  Opportunity,
  QuoteRequest,
  Vehicle,
} from "./domain/entities.js";
import {
  CommercialOutcome,
  CommercialEventType,
  AppointmentStatus,
  ConversationStatus,
  HandoffReason,
  HandoffStatus,
  Intent,
  OpportunityStatus,
  OutboundDeliveryStatus,
  QuoteDraftStatus,
  QuoteRequestStatus,
  SenderType,
} from "./domain/enums.js";
import type { AIInterpretation, NextAction } from "./domain/types.js";
import type {
  AutomotiveBusinessRepository,
  ConversationRepository,
  AppointmentRepository,
  CommercialEventRepository,
  CustomerRepository,
  HumanHandoffRepository,
  MessageRepository,
  OpportunityRepository,
  OutboundDeliveryRepository,
  QuoteDraftRepository,
  QuoteRequestRepository,
  VehicleRepository,
} from "./repositories.js";
import type { MessageInterpreter } from "./message-interpreter.js";
import { appendCommercialEventSafely } from "./append-commercial-event-safely.js";
import type { LlmGuard } from "./llm-guard.js";
import { isRedactionMarker } from "./redact-personal-data.js";
import {
  OPENING_NOTICE_INTERVAL_MS, OPENING_NOTICE_PREFIX, buildBusinessFacts, closedNotice, formatLocalDateTime,
  type BusinessFacts, type BusinessProfileRepository,
} from "./business-profile.js";

export const MAX_MESSAGE_CHARS = 4000;
export const PRIVACY_NOTICE_PREFIX = "Olá! Sou o assistente virtual da oficina";
const FIXED_REPLY_INTERVAL_MS = 10 * 60 * 1000;
const HANDOFF_SUMMARY_MESSAGES = 5;
const HANDOFF_SUMMARY_CHARS = 500;
const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const LOCKING_DRAFT_STATUSES: readonly QuoteDraftStatus[] = [QuoteDraftStatus.PENDING_APPROVAL, QuoteDraftStatus.APPROVED, QuoteDraftStatus.PUBLISHED];

export type ProcessMessageInput = {
  businessId: string;
  conversationId: string;
  content: string;
};

export type ReceivedCustomerMessage = {
  conversation: Conversation;
  content: string;
  history: Message[];
};

export type InterpretationOutcome =
  | { status: "INTERPRETED"; interpretation: AIInterpretation }
  // HUMAN_ACTIVE: a person has the conversation, so the message is kept and nobody answers it.
  | { status: "FAILED" | "LIMITED" | "UNSUPPORTED" | "HUMAN_ACTIVE" };

export type AppliedMessage = {
  conversationId: string;
  reply: string;
  intent: Intent;
  conversationStatus: ConversationStatus;
  commercialOutcome: CommercialOutcome | undefined;
  requiresHuman: boolean;
  // The reply was withheld (auto-responder loop, or a person has the conversation): nothing goes out.
  silenced?: boolean;
  // A new handoff was opened by this message; the caller tells the workshop once the transaction is committed.
  handoffOpened?: true;
  // The customer wrote into a conversation a person took; the caller tells the workshop once the transaction is committed.
  customerWroteToPerson?: true;
};

export type ProcessMessageDependencies = {
  conversationRepository: ConversationRepository;
  appointmentRepository: AppointmentRepository;
  messageRepository: MessageRepository;
  customerRepository: CustomerRepository;
  vehicleRepository: VehicleRepository;
  humanHandoffRepository: HumanHandoffRepository;
  opportunityRepository: OpportunityRepository;
  quoteRequestRepository: QuoteRequestRepository;
  quoteDraftRepository?: Pick<QuoteDraftRepository, "findLatestByQuoteRequest">;
  // Without it no quote counts as delivered to the customer.
  outboundDeliveryRepository?: Pick<OutboundDeliveryRepository, "findByQuoteRequestAndChannel">;
  commercialEventRepository?: CommercialEventRepository;
  businessProfileRepository?: Pick<BusinessProfileRepository, "findByBusinessId">;
  businessRepository?: Pick<AutomotiveBusinessRepository, "findById">;
  interpreter: MessageInterpreter;
  llmGuard?: LlmGuard;
  // Where the privacy notice lives (PUBLIC_ORIGIN/privacidade). Without it there is no link to give, so no notice is added.
  publicOrigin?: string;
  now: () => string;
  generateId: (prefix: string) => string;
};

export async function processMessage(
  input: ProcessMessageInput,
  dependencies: ProcessMessageDependencies,
) {
  const received = await receiveCustomerMessage(input, dependencies);
  const outcome = await interpretCustomerMessage(received, input.conversationId, dependencies);
  return applyInterpretation(input, outcome, dependencies);
}

export async function receiveCustomerMessage(
  input: ProcessMessageInput & { externalMessageId?: string },
  dependencies: ProcessMessageDependencies,
): Promise<ReceivedCustomerMessage> {
  const conversation = await requireConversation(input, dependencies);
  const history = await dependencies.messageRepository.listByConversation(
    conversation.businessId,
    conversation.id,
  );
  // A webhook retried after a crash must not store the same customer message twice.
  if (input.externalMessageId !== undefined && history.some(({ externalMessageId }) => externalMessageId === input.externalMessageId)) {
    return { conversation, content: input.content, history };
  }

  const customerMessage: Message = {
    id: dependencies.generateId("message"),
    businessId: conversation.businessId,
    conversationId: conversation.id,
    senderType: SenderType.CUSTOMER,
    channel: conversation.channel,
    content: input.content,
    ...(input.externalMessageId === undefined ? {} : { externalMessageId: input.externalMessageId }),
    createdAt: dependencies.now(),
  };
  await dependencies.messageRepository.save(customerMessage);
  return { conversation, content: input.content, history: [...history, customerMessage] };
}

export async function interpretCustomerMessage(
  received: ReceivedCustomerMessage,
  senderKey: string,
  dependencies: ProcessMessageDependencies,
): Promise<InterpretationOutcome> {
  const { conversation, content, history } = received;
  if (conversation.status === ConversationStatus.WAITING_HUMAN) return { status: "HUMAN_ACTIVE" };
  if (dependencies.llmGuard && !(await dependencies.llmGuard.allow(conversation.businessId, senderKey))) {
    return { status: "LIMITED" };
  }
  try {
    const interpretation = await dependencies.interpreter.interpret({
      businessId: conversation.businessId,
      conversationId: conversation.id,
      content,
      history,
      ...(await loadBusinessContext(conversation.businessId, dependencies)),
    });
    return { status: "INTERPRETED", interpretation };
  } catch {
    return { status: "FAILED" };
  }
}

export async function applyInterpretation(
  input: ProcessMessageInput,
  outcome: InterpretationOutcome,
  dependencies: ProcessMessageDependencies,
): Promise<AppliedMessage> {
  // Read here, not at reception: concurrent messages of the sender may have changed it during the LLM call.
  const conversation = await requireConversation(input, dependencies);
  if (conversation.status === ConversationStatus.WAITING_HUMAN || outcome.status === "HUMAN_ACTIVE") return applyHumanActive(conversation, dependencies);
  if (outcome.status !== "INTERPRETED") return applyFixedReply(input, conversation, outcome.status, dependencies);
  const { interpretation } = outcome;

  const technicalDiagnosisHandoff = requiresTechnicalDiagnosisHandoff(
    input.content,
  );
  // Accepting a price is usually an APPOINTMENT_REQUEST: it records the appointment and still reaches a person.
  const deliveredQuote = await readDeliveredQuoteState(conversation, dependencies);
  const answeringQuote = deliveredQuote === "UNANSWERED";
  const interpretationRequiresHuman =
    requiresExplicitHumanHandoff(interpretation.intent) ||
    technicalDiagnosisHandoff ||
    interpretation.requiresHuman ||
    answeringQuote;

  const customerUpdates = Object.fromEntries(
    Object.entries(interpretation.extractedCustomerData).filter(
      ([, value]) => typeof value === "string" && value.trim().length > 0 && !isRedactionMarker(value),
    ),
  ) as typeof interpretation.extractedCustomerData;
  const hasUsefulCustomerData = Object.keys(customerUpdates).length > 0;

  let customerId = conversation.customerId;
  let existingCustomer = customerId
    ? await dependencies.customerRepository.findById(
        conversation.businessId,
        customerId,
      )
    : null;

  if (existingCustomer && hasUsefulCustomerData) {
    existingCustomer = {
      ...existingCustomer,
      ...customerUpdates,
      updatedAt: dependencies.now(),
    };
    await dependencies.customerRepository.save(existingCustomer);
  } else if (customerId === undefined && hasUsefulCustomerData) {
    const now = dependencies.now();
    const customer: Customer = {
      id: dependencies.generateId("customer"),
      businessId: conversation.businessId,
      ...customerUpdates,
      createdAt: now,
      updatedAt: now,
    };
    await dependencies.customerRepository.save(customer);
    customerId = customer.id;
    existingCustomer = customer;
  }

  const extractedVehicleData = interpretation.extractedVehicleData;
  const candidateVehicleUpdates = Object.fromEntries(
    Object.entries(extractedVehicleData).filter(([, value]) => value !== undefined && !isRedactionMarker(value)),
  ) as typeof extractedVehicleData;
  // A priced quote was computed for this vehicle; changing it now would silently detach the price from it.
  const vehicleLocked = Object.keys(candidateVehicleUpdates).length > 0 && await hasPricedQuote(conversation, dependencies);
  const vehicleUpdates: typeof extractedVehicleData = vehicleLocked ? {} : candidateVehicleUpdates;
  const hasUsefulVehicleData = Object.values(vehicleUpdates).some((value) =>
    typeof value === "string" ? value.trim().length > 0 : value !== undefined,
  );

  let vehicleId = conversation.vehicleId;
  let existingVehicle = vehicleId
    ? await dependencies.vehicleRepository.findById(
        conversation.businessId,
        vehicleId,
      )
    : null;
  let effectiveVehicleData = vehicleUpdates;

  if (existingVehicle) {
    const customerAssociation = customerId !== undefined &&
        existingVehicle.customerId !== customerId
      ? { customerId }
      : {};
    if (
      Object.keys(vehicleUpdates).length > 0 ||
      Object.keys(customerAssociation).length > 0
    ) {
      existingVehicle = {
        ...existingVehicle,
        ...vehicleUpdates,
        ...customerAssociation,
        updatedAt: dependencies.now(),
      };
      await dependencies.vehicleRepository.save(existingVehicle);
    }
    effectiveVehicleData = { ...existingVehicle, ...vehicleUpdates };
  } else if (vehicleId === undefined && hasUsefulVehicleData) {
    const now = dependencies.now();
    const vehicle: Vehicle = {
      id: dependencies.generateId("vehicle"),
      businessId: conversation.businessId,
      ...(customerId !== undefined
        ? { customerId }
        : {}),
      ...vehicleUpdates,
      createdAt: now,
      updatedAt: now,
    };
    await dependencies.vehicleRepository.save(vehicle);
    vehicleId = vehicle.id;
    existingVehicle = vehicle;
    effectiveVehicleData = vehicle;
  }

  const quoteRequested = interpretation.intent === Intent.QUOTE_REQUEST;
  const quoteMissingData = quoteRequested
    ? getQuoteIntakeMissingData(interpretation)
    : [];
  const quoteNextAction: NextAction = quoteMissingData.length > 0
    ? {
        type: "REQUEST_INFORMATION",
        description: "Solicitar informações necessárias para o orçamento",
      }
    : {
        type: "PROVIDE_QUOTE",
        description: "Fornecer orçamento ao cliente",
      };
  const profile = await dependencies.businessProfileRepository?.findByBusinessId(conversation.businessId);
  const safeReply = resolveSafeReply({
    ...(profile ? { businessFacts: buildBusinessFacts(profile) } : {}),
    intent: interpretation.intent,
    proposedResponse: interpretation.proposedResponse,
    requiresHuman: interpretationRequiresHuman,
    suggestedNextAction: quoteRequested
      ? quoteNextAction
      : interpretation.suggestedNextAction,
    missingData: quoteRequested
      ? quoteMissingData
      : interpretation.missingData,
  });
  // The blocked-reply text promises the team will follow up, so a person must be told.
  const requiresHuman = interpretationRequiresHuman || safeReply.blocked;
  let reply = safeReply.reply;
  let quoteLocked = false;

  const appointmentRequested =
    interpretation.intent === Intent.APPOINTMENT_REQUEST;

  if (quoteRequested) {
    const now = dependencies.now();
    const waitingForCustomer = quoteMissingData.length > 0 && !requiresHuman;
    const opportunityStatus = waitingForCustomer
      ? OpportunityStatus.WAITING_CUSTOMER
      : OpportunityStatus.WAITING_BUSINESS;
    const quoteRequestStatus = waitingForCustomer
      ? QuoteRequestStatus.WAITING_INFORMATION
      : QuoteRequestStatus.WAITING_BUSINESS;

    const opportunities = await dependencies.opportunityRepository.listByConversation(
      conversation.businessId,
      conversation.id,
    );
    const activeOpportunity = opportunities
      .filter(({ status }) =>
        status === OpportunityStatus.OPEN ||
        status === OpportunityStatus.WAITING_CUSTOMER ||
        status === OpportunityStatus.WAITING_BUSINESS,
      )
      .at(-1);
    const quoteRequests = await dependencies.quoteRequestRepository.listByConversation(
      conversation.businessId,
      conversation.id,
    );
    const activeQuoteRequest = activeOpportunity
      ? quoteRequests
          .filter((quoteRequest) =>
            quoteRequest.opportunityId === activeOpportunity.id &&
            (quoteRequest.status === QuoteRequestStatus.REQUESTED ||
              quoteRequest.status === QuoteRequestStatus.WAITING_INFORMATION ||
              quoteRequest.status === QuoteRequestStatus.WAITING_BUSINESS),
          )
          .at(-1)
      : undefined;

    if (activeOpportunity && activeQuoteRequest) {
      const updated = await dependencies.quoteRequestRepository.updateIntake({
        ...activeQuoteRequest,
        ...(customerId !== undefined ? { customerId } : {}),
        requestDescription:
          interpretation.requestedItem?.trim() || activeQuoteRequest.requestDescription,
        ...(interpretation.symptomDescription !== undefined
          ? { symptomDescription: interpretation.symptomDescription }
          : {}),
        status: quoteRequestStatus,
        updatedAt: now,
      });

      quoteLocked = !updated;
      if (updated) {
        await dependencies.opportunityRepository.save({
          ...activeOpportunity,
          ...(customerId !== undefined ? { customerId } : {}),
          requestDescription:
            interpretation.requestedItem?.trim() || activeOpportunity.requestDescription || input.content,
          status: opportunityStatus,
          nextAction: quoteNextAction,
          updatedAt: now,
        });
      }
    } else if (hasRespondedQuoteForItem(quoteRequests, interpretation.requestedItem)) {
      quoteLocked = true;
    } else {
      const requestDescription =
        interpretation.requestedItem?.trim() || input.content;
      const opportunity: Opportunity = {
        id: dependencies.generateId("opportunity"),
        businessId: conversation.businessId,
        conversationId: conversation.id,
        ...(customerId !== undefined
          ? { customerId }
          : {}),
        ...(vehicleId !== undefined
          ? { vehicleId }
          : {}),
        requestDescription,
        status: opportunityStatus,
        nextAction: quoteNextAction,
        createdAt: now,
        updatedAt: now,
      };
      await dependencies.opportunityRepository.save(opportunity);

      const quoteRequest: QuoteRequest = {
        id: dependencies.generateId("quote"),
        businessId: conversation.businessId,
        opportunityId: opportunity.id,
        conversationId: conversation.id,
        ...(customerId !== undefined
          ? { customerId }
          : {}),
        ...(vehicleId !== undefined
          ? { vehicleId }
          : {}),
        requestDescription,
        ...(interpretation.symptomDescription !== undefined
          ? { symptomDescription: interpretation.symptomDescription }
          : {}),
        status: quoteRequestStatus,
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await dependencies.quoteRequestRepository.save(quoteRequest);
      if (dependencies.commercialEventRepository !== undefined) {
        await appendCommercialEventSafely(dependencies.commercialEventRepository, () => {
          const event: CommercialEvent = {
            id: dependencies.generateId("commercial-event"),
            businessId: conversation.businessId,
            eventType: CommercialEventType.QUOTE_REQUESTED,
            conversationId: conversation.id,
            ...(customerId !== undefined ? { customerId } : {}),
            ...(vehicleId !== undefined ? { vehicleId } : {}),
            opportunityId: opportunity.id,
            quoteRequestId: quoteRequest.id,
            channel: conversation.channel,
            intent: interpretation.intent,
            commercialOutcome: CommercialOutcome.QUOTE_REQUESTED,
            ...(interpretation.requestedItem !== undefined
              ? { requestedItem: interpretation.requestedItem }
              : {}),
            ...(interpretation.symptomDescription !== undefined
              ? { symptom: interpretation.symptomDescription }
              : {}),
            ...(effectiveVehicleData.brand !== undefined
              ? { vehicleBrand: effectiveVehicleData.brand }
              : {}),
            ...(effectiveVehicleData.model !== undefined
              ? { vehicleModel: effectiveVehicleData.model }
              : {}),
            ...(effectiveVehicleData.year !== undefined
              ? { vehicleYear: effectiveVehicleData.year }
              : {}),
            occurredAt: now,
          };
          return event;
        });
      }
    }
  }

  if (quoteLocked && !requiresHuman) reply = QUOTE_LOCKED_REPLY;
  // A locked quote is a change only a person can weigh, so its text and a handoff go together.
  const handedOff = requiresHuman || (quoteLocked && deliveredQuote !== "HANDED_OFF");

  if (appointmentRequested) {
    const acceptedQuote = (await dependencies.quoteRequestRepository.listByConversation(
      conversation.businessId,
      conversation.id,
    )).filter((quote) => quote.status === QuoteRequestStatus.RESPONDED && quote.authorizedPrice !== undefined).at(-1);
    if ((await findActiveAppointment(conversation, dependencies)) === undefined) {
      const now = dependencies.now();
      const appointment: Appointment = {
        id: dependencies.generateId("appointment"),
        businessId: conversation.businessId,
        ...(acceptedQuote === undefined ? {} : { opportunityId: acceptedQuote.opportunityId }),
        conversationId: conversation.id,
        ...(customerId !== undefined ? { customerId } : {}),
        ...(vehicleId !== undefined ? { vehicleId } : {}),
        status: AppointmentStatus.REQUESTED,
        requestDescription: acceptedQuote?.requestDescription ?? interpretation.requestedItem ?? input.content,
        createdAt: now,
        updatedAt: now,
      };
      await dependencies.appointmentRepository.save(appointment);
      if (dependencies.commercialEventRepository !== undefined) {
        await appendCommercialEventSafely(dependencies.commercialEventRepository, () => ({
          id: dependencies.generateId("commercial-event"),
          businessId: conversation.businessId,
          eventType: CommercialEventType.APPOINTMENT_REQUESTED,
          conversationId: conversation.id,
          ...(customerId !== undefined ? { customerId } : {}),
          ...(vehicleId !== undefined ? { vehicleId } : {}),
          ...(acceptedQuote === undefined ? {} : { opportunityId: acceptedQuote.opportunityId, quoteRequestId: acceptedQuote.id }),
          channel: conversation.channel,
          intent: interpretation.intent,
          commercialOutcome: CommercialOutcome.APPOINTMENT_REQUESTED,
          ...(appointment.requestDescription === undefined ? {} : { requestedItem: appointment.requestDescription }),
          occurredAt: now,
        }));
      }
    }
  }

  let handoffOpened = false;
  if (handedOff) {
    const handoffReason =
      interpretation.intent === Intent.HUMAN_REQUEST
        ? HandoffReason.CUSTOMER_REQUEST
        : technicalDiagnosisHandoff
          ? HandoffReason.DIAGNOSIS_REQUIRED
        : safeReply.blocked
          ? HandoffReason.UNKNOWN_INFORMATION
        : (interpretation.handoffReason ?? (interpretation.intent === Intent.WARRANTY || interpretation.intent === Intent.COMPLAINT
          ? HandoffReason.WARRANTY_OR_COMPLAINT
          : HandoffReason.OTHER));
    handoffOpened = await openHandoff(conversation, handoffReason, dependencies);
  }

  let updatedConversation: Conversation = {
    ...conversation,
    ...(customerId !== undefined ? { customerId } : {}),
    ...(vehicleId !== undefined ? { vehicleId } : {}),
    currentIntent: interpretation.intent,
    lastMessageAt: dependencies.now(),
  };

  if (quoteRequested && !quoteLocked) {
    updatedConversation = {
      ...updatedConversation,
      commercialOutcome: CommercialOutcome.QUOTE_REQUESTED,
    };
  }

  if (appointmentRequested) {
    updatedConversation = {
      ...updatedConversation,
      commercialOutcome: CommercialOutcome.APPOINTMENT_REQUESTED,
    };
  }

  if (handedOff) {
    updatedConversation = {
      ...updatedConversation,
      status: ConversationStatus.WAITING_HUMAN,
      commercialOutcome: CommercialOutcome.HUMAN_HANDOFF,
    };
  }

  await dependencies.conversationRepository.save(updatedConversation);
  reply = await withPrivacyNotice(conversation, customerId, await withOpeningNotice(conversation, reply, dependencies), dependencies);
  await saveAssistantReply(conversation, reply, dependencies);

  return {
    conversationId: updatedConversation.id,
    reply,
    intent: interpretation.intent,
    conversationStatus: updatedConversation.status,
    commercialOutcome: updatedConversation.commercialOutcome,
    requiresHuman: handedOff,
    ...(handoffOpened ? { handoffOpened } : {}),
  };
}

// Nothing is written: a stale copy saved back could undo the person giving the conversation to the bot. The idle clock restarts when they do.
async function applyHumanActive(conversation: Conversation, dependencies: ProcessMessageDependencies): Promise<AppliedMessage> {
  const open = await dependencies.humanHandoffRepository.listOpen(conversation.businessId);
  const taken = open.some(({ conversationId, status }) => conversationId === conversation.id && status === HandoffStatus.ACCEPTED);
  return {
    conversationId: conversation.id,
    reply: "",
    intent: conversation.currentIntent ?? Intent.OTHER,
    conversationStatus: conversation.status,
    commercialOutcome: conversation.commercialOutcome,
    requiresHuman: true,
    silenced: true,
    ...(taken ? { customerWroteToPerson: true } : {}),
  };
}

async function applyFixedReply(
  input: ProcessMessageInput,
  conversation: Conversation,
  status: Exclude<InterpretationOutcome["status"], "INTERPRETED">,
  dependencies: ProcessMessageDependencies,
): Promise<AppliedMessage> {
  const failed = status === "FAILED";
  // An audio, or a sender over the limit, can be the answer to the price too.
  const answeringQuote = !failed && (await readDeliveredQuoteState(conversation, dependencies)) === "UNANSWERED";
  const handedOff = failed || answeringQuote;
  const handoffOpened = handedOff && await openHandoff(conversation, failed ? HandoffReason.AI_FAILURE : HandoffReason.OTHER, dependencies);
  const fixedReply = failed ? LLM_FAILURE_REPLY : answeringQuote ? HANDOFF_REPLY : status === "LIMITED" ? LLM_LIMITED_REPLY : UNSUPPORTED_MESSAGE_REPLY;
  const updatedConversation: Conversation = {
    ...conversation,
    lastMessageAt: dependencies.now(),
    ...(handedOff ? { status: ConversationStatus.WAITING_HUMAN, commercialOutcome: CommercialOutcome.HUMAN_HANDOFF } : {}),
  };
  const silenced = !handedOff && await fixedReplySentRecently(conversation, dependencies);
  await dependencies.conversationRepository.save(updatedConversation);
  const reply = silenced ? fixedReply : await withPrivacyNotice(conversation, conversation.customerId, await withOpeningNotice(conversation, fixedReply, dependencies), dependencies);
  if (!silenced) await saveAssistantReply(conversation, reply, dependencies);

  return {
    conversationId: updatedConversation.id,
    reply,
    intent: updatedConversation.currentIntent ?? Intent.OTHER,
    conversationStatus: updatedConversation.status,
    commercialOutcome: updatedConversation.commercialOutcome,
    requiresHuman: handedOff,
    ...(silenced ? { silenced } : {}),
    ...(handoffOpened ? { handoffOpened } : {}),
  };
}

async function fixedReplySentRecently(conversation: Conversation, dependencies: ProcessMessageDependencies): Promise<boolean> {
  const cutoff = Date.parse(dependencies.now()) - FIXED_REPLY_INTERVAL_MS;
  const history = await dependencies.messageRepository.listByConversation(conversation.businessId, conversation.id);
  return history.some(({ senderType, content, createdAt }) =>
    senderType === SenderType.ASSISTANT &&
    (content.includes(LLM_LIMITED_REPLY) || content.includes(UNSUPPORTED_MESSAGE_REPLY)) &&
    Date.parse(createdAt) > cutoff,
  );
}

async function hasPricedQuote(conversation: Conversation, dependencies: ProcessMessageDependencies): Promise<boolean> {
  const quotes = (await dependencies.quoteRequestRepository.listByConversation(conversation.businessId, conversation.id))
    .filter(({ status }) => status !== QuoteRequestStatus.CANCELLED && status !== QuoteRequestStatus.CLOSED);
  if (quotes.some(({ authorizedPrice }) => authorizedPrice !== undefined)) return true;
  for (const quote of quotes) {
    const draft = await dependencies.quoteDraftRepository?.findLatestByQuoteRequest(conversation.businessId, quote.id);
    if (draft && LOCKING_DRAFT_STATUSES.includes(draft.status)) return true;
  }
  return false;
}

async function findActiveAppointment(conversation: Conversation, dependencies: ProcessMessageDependencies): Promise<Appointment | undefined> {
  return (await dependencies.appointmentRepository.listByConversation(conversation.businessId, conversation.id))
    .filter(({ status }) => status === AppointmentStatus.REQUESTED || status === AppointmentStatus.CONFIRMED).at(-1);
}

// A customer who got a price and has no appointment is answering that price, whatever the words: a person must see it (UNANSWERED).
// Once per quote: any handoff created after the quote's last update, open or closed, gave a person that chance, so the bot answers again (HANDED_OFF).
async function readDeliveredQuoteState(conversation: Conversation, dependencies: ProcessMessageDependencies): Promise<"NONE" | "UNANSWERED" | "HANDED_OFF"> {
  const deliveries = dependencies.outboundDeliveryRepository;
  if (deliveries === undefined || (await findActiveAppointment(conversation, dependencies)) !== undefined) return "NONE";
  const handoffs = await dependencies.humanHandoffRepository.listByConversation(conversation.businessId, conversation.id);
  let state: "NONE" | "HANDED_OFF" = "NONE";
  for (const quote of await dependencies.quoteRequestRepository.listByConversation(conversation.businessId, conversation.id)) {
    if (quote.status !== QuoteRequestStatus.RESPONDED) continue;
    const delivery = await deliveries.findByQuoteRequestAndChannel(conversation.businessId, quote.id, conversation.channel);
    if (delivery?.status !== OutboundDeliveryStatus.DELIVERED) continue;
    if (!handoffs.some(({ createdAt }) => createdAt >= quote.updatedAt)) return "UNANSWERED";
    state = "HANDED_OFF";
  }
  return state;
}

function hasRespondedQuoteForItem(quotes: readonly QuoteRequest[], requestedItem: string | undefined): boolean {
  if (!requestedItem?.trim()) return false;
  const item = normalizeItemName(requestedItem);
  return quotes.some(({ status, requestDescription }) =>
    status === QuoteRequestStatus.RESPONDED && normalizeItemName(requestDescription) === item);
}

function normalizeItemName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

async function requireConversation(input: ProcessMessageInput, dependencies: ProcessMessageDependencies): Promise<Conversation> {
  const conversation = await dependencies.conversationRepository.findById(
    input.businessId,
    input.conversationId,
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }
  return conversation;
}

// ponytail: reads every open handoff of the business to find this conversation's; add a by-conversation query when the open queue gets long.
export async function openHandoff(
  conversation: Conversation,
  reason: HandoffReason,
  dependencies: Pick<ProcessMessageDependencies, "humanHandoffRepository" | "messageRepository" | "now" | "generateId">,
): Promise<boolean> {
  const open = await dependencies.humanHandoffRepository.listOpen(conversation.businessId);
  if (open.some(({ conversationId }) => conversationId === conversation.id)) return false;
  const customerMessages = (await dependencies.messageRepository.listByConversation(conversation.businessId, conversation.id))
    .filter(({ senderType }) => senderType === SenderType.CUSTOMER);
  const summary = customerMessages.slice(-HANDOFF_SUMMARY_MESSAGES).map(({ content }) => content).join("\n").slice(-HANDOFF_SUMMARY_CHARS);
  const now = dependencies.now();
  const handoff: HumanHandoff = {
    id: dependencies.generateId("handoff"),
    businessId: conversation.businessId,
    conversationId: conversation.id,
    reason,
    summary,
    status: HandoffStatus.REQUESTED,
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await dependencies.humanHandoffRepository.save(handoff);
  return true;
}

async function loadBusinessContext(businessId: string, dependencies: ProcessMessageDependencies): Promise<{ businessFacts?: BusinessFacts; localDateTime?: string }> {
  const profile = await dependencies.businessProfileRepository?.findByBusinessId(businessId);
  if (!profile) return {};
  return {
    businessFacts: buildBusinessFacts(profile),
    localDateTime: formatLocalDateTime(dependencies.now(), await businessTimezone(businessId, dependencies)),
  };
}

export async function businessTimezone(businessId: string, dependencies: Pick<ProcessMessageDependencies, "businessRepository">): Promise<string> {
  return (await dependencies.businessRepository?.findById(businessId))?.timezone ?? DEFAULT_TIMEZONE;
}

// Outside business hours every automatic answer says when the workshop opens, but only once per conversation every 12 hours.
async function withOpeningNotice(conversation: Conversation, reply: string, dependencies: ProcessMessageDependencies): Promise<string> {
  const profile = await dependencies.businessProfileRepository?.findByBusinessId(conversation.businessId);
  if (!profile) return reply;
  const now = dependencies.now();
  const notice = closedNotice(profile, now, await businessTimezone(conversation.businessId, dependencies));
  if (notice === undefined) return reply;
  const cutoff = Date.parse(now) - OPENING_NOTICE_INTERVAL_MS;
  const history = await dependencies.messageRepository.listByConversation(conversation.businessId, conversation.id);
  const alreadyTold = history.some(({ senderType, content, createdAt }) =>
    senderType === SenderType.ASSISTANT && content.includes(OPENING_NOTICE_PREFIX) && Date.parse(createdAt) > cutoff);
  return alreadyTold ? reply : `${reply}\n${notice}`;
}

// The first reply ever sent to a customer says who is answering, that data is processed to serve them, and where to read more.
// The customer's mark survives the idle closing of the conversation; a conversation without a customer record falls back to its own history.
async function withPrivacyNotice(conversation: Conversation, customerId: string | undefined, reply: string, dependencies: ProcessMessageDependencies): Promise<string> {
  const publicOrigin = dependencies.publicOrigin;
  if (publicOrigin === undefined) return reply;
  const customer = customerId === undefined ? null : await dependencies.customerRepository.findById(conversation.businessId, customerId);
  if (customer?.privacyNoticeAt !== undefined) return reply;
  const history = await dependencies.messageRepository.listByConversation(conversation.businessId, conversation.id);
  const alreadyTold = history.some(({ senderType, content }) => senderType === SenderType.ASSISTANT && content.startsWith(PRIVACY_NOTICE_PREFIX));
  if (customer !== null) await dependencies.customerRepository.save({ ...customer, privacyNoticeAt: dependencies.now() });
  if (alreadyTold) return reply;
  const businessName = (await dependencies.businessRepository?.findById(conversation.businessId))?.name;
  return `${PRIVACY_NOTICE_PREFIX}${businessName ? ` ${businessName}` : ""}. Seus dados são tratados para o seu atendimento. Saiba mais em ${publicOrigin.replace(/\/+$/, "")}/privacidade.\n\n${reply}`;
}

async function saveAssistantReply(
  conversation: Conversation,
  content: string,
  dependencies: ProcessMessageDependencies,
): Promise<void> {
  const assistantMessage: Message = {
    id: dependencies.generateId("message"),
    businessId: conversation.businessId,
    conversationId: conversation.id,
    senderType: SenderType.ASSISTANT,
    channel: conversation.channel,
    content,
    createdAt: dependencies.now(),
  };
  await dependencies.messageRepository.save(assistantMessage);
}
