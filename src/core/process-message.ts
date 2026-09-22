import { requiresExplicitHumanHandoff } from "./business-rules.js";
import type {
  Conversation,
  HumanHandoff,
  Message,
  Opportunity,
  QuoteRequest,
} from "./domain/entities.js";
import {
  CommercialOutcome,
  ConversationStatus,
  HandoffReason,
  HandoffStatus,
  Intent,
  OpportunityStatus,
  QuoteRequestStatus,
  SenderType,
} from "./domain/enums.js";
import type { AIInterpretation, NextAction } from "./domain/types.js";
import type {
  ConversationRepository,
  HumanHandoffRepository,
  MessageRepository,
  OpportunityRepository,
  QuoteRequestRepository,
} from "./repositories.js";
import type { MessageInterpreter } from "./message-interpreter.js";

export type ProcessMessageInput = {
  businessId: string;
  conversationId: string;
  content: string;
};

export type ProcessMessageDependencies = {
  conversationRepository: ConversationRepository;
  messageRepository: MessageRepository;
  humanHandoffRepository: HumanHandoffRepository;
  opportunityRepository: OpportunityRepository;
  quoteRequestRepository: QuoteRequestRepository;
  interpreter: MessageInterpreter;
  now: () => string;
  generateId: (prefix: string) => string;
};

export async function processMessage(
  input: ProcessMessageInput,
  dependencies: ProcessMessageDependencies,
) {
  const conversation = await dependencies.conversationRepository.findById(
    input.businessId,
    input.conversationId,
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const customerMessage: Message = {
    id: dependencies.generateId("message"),
    businessId: conversation.businessId,
    conversationId: conversation.id,
    senderType: SenderType.CUSTOMER,
    channel: conversation.channel,
    content: input.content,
    createdAt: dependencies.now(),
  };
  await dependencies.messageRepository.save(customerMessage);

  const history = await dependencies.messageRepository.listByConversation(
    conversation.businessId,
    conversation.id,
  );
  const interpretation: AIInterpretation =
    await dependencies.interpreter.interpret({
      businessId: conversation.businessId,
      conversationId: conversation.id,
      content: input.content,
      history,
    });

  const requiresHuman =
    requiresExplicitHumanHandoff(interpretation.intent) ||
    interpretation.requiresHuman;

  const quoteRequested = interpretation.intent === Intent.QUOTE_REQUEST;

  if (quoteRequested) {
    const now = dependencies.now();
    const requestDescription =
      interpretation.requestedItem ?? input.content;
    const nextAction: NextAction = {
      type: "PROVIDE_QUOTE",
      description: "Fornecer orçamento ao cliente",
    };
    const opportunity: Opportunity = {
      id: dependencies.generateId("opportunity"),
      businessId: conversation.businessId,
      conversationId: conversation.id,
      ...(conversation.customerId !== undefined
        ? { customerId: conversation.customerId }
        : {}),
      ...(conversation.vehicleId !== undefined
        ? { vehicleId: conversation.vehicleId }
        : {}),
      requestDescription,
      status: OpportunityStatus.WAITING_BUSINESS,
      nextAction,
      createdAt: now,
      updatedAt: now,
    };
    await dependencies.opportunityRepository.save(opportunity);

    const quoteRequest: QuoteRequest = {
      id: dependencies.generateId("quote"),
      businessId: conversation.businessId,
      opportunityId: opportunity.id,
      conversationId: conversation.id,
      ...(conversation.customerId !== undefined
        ? { customerId: conversation.customerId }
        : {}),
      ...(conversation.vehicleId !== undefined
        ? { vehicleId: conversation.vehicleId }
        : {}),
      requestDescription,
      ...(interpretation.symptomDescription !== undefined
        ? { symptomDescription: interpretation.symptomDescription }
        : {}),
      status: QuoteRequestStatus.WAITING_BUSINESS,
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await dependencies.quoteRequestRepository.save(quoteRequest);
  }

  if (requiresHuman) {
    const now = dependencies.now();
    const handoffReason =
      interpretation.intent === Intent.HUMAN_REQUEST
        ? HandoffReason.CUSTOMER_REQUEST
        : (interpretation.handoffReason ?? HandoffReason.OTHER);
    const handoff: HumanHandoff = {
      id: dependencies.generateId("handoff"),
      businessId: conversation.businessId,
      conversationId: conversation.id,
      reason: handoffReason,
      summary: input.content,
      status: HandoffStatus.REQUESTED,
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await dependencies.humanHandoffRepository.save(handoff);
  }

  let updatedConversation: Conversation = {
    ...conversation,
    currentIntent: interpretation.intent,
    lastMessageAt: dependencies.now(),
  };

  if (quoteRequested) {
    updatedConversation = {
      ...updatedConversation,
      commercialOutcome: CommercialOutcome.QUOTE_REQUESTED,
    };
  }

  if (requiresHuman) {
    updatedConversation = {
      ...updatedConversation,
      status: ConversationStatus.WAITING_HUMAN,
      commercialOutcome: CommercialOutcome.HUMAN_HANDOFF,
    };
  }

  await dependencies.conversationRepository.save(updatedConversation);

  const assistantMessage: Message = {
    id: dependencies.generateId("message"),
    businessId: conversation.businessId,
    conversationId: conversation.id,
    senderType: SenderType.ASSISTANT,
    channel: conversation.channel,
    content: interpretation.proposedResponse,
    createdAt: dependencies.now(),
  };
  await dependencies.messageRepository.save(assistantMessage);

  return {
    conversationId: updatedConversation.id,
    reply: interpretation.proposedResponse,
    intent: interpretation.intent,
    conversationStatus: updatedConversation.status,
    commercialOutcome: updatedConversation.commercialOutcome,
    requiresHuman,
  };
}
