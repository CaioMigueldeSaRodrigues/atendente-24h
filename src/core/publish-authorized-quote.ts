import type { CommercialEvent, Conversation, Message } from "./domain/entities.js";
import { CommercialEventType, SenderType } from "./domain/enums.js";
import { buildAuthorizedQuoteReply } from "./quote-presentation.js";
import type {
  ConversationRepository,
  CommercialEventRepository,
  MessageRepository,
  QuoteRequestRepository,
} from "./repositories.js";
import { appendCommercialEventSafely } from "./append-commercial-event-safely.js";

export type PublishAuthorizedQuoteInput = {
  businessId: string;
  quoteRequestId: string;
};

export type PublishAuthorizedQuoteDependencies = {
  quoteRequestRepository: QuoteRequestRepository;
  conversationRepository: ConversationRepository;
  messageRepository: MessageRepository;
  commercialEventRepository?: CommercialEventRepository;
  strictCommercialEventPersistence?: boolean;
  generateId: (prefix: string) => string;
  now: () => string;
};

export async function publishAuthorizedQuote(
  input: PublishAuthorizedQuoteInput,
  dependencies: PublishAuthorizedQuoteDependencies,
) {
  const quoteRequest = await dependencies.quoteRequestRepository.findById(
    input.businessId,
    input.quoteRequestId,
  );

  if (!quoteRequest) {
    throw new Error("QuoteRequest not found");
  }

  const content = buildAuthorizedQuoteReply(quoteRequest);
  const conversation = await dependencies.conversationRepository.findById(
    input.businessId,
    quoteRequest.conversationId,
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const existingPublishedMessage = (await dependencies.messageRepository.listByConversation(
    input.businessId,
    conversation.id,
  )).find((candidate) =>
    candidate.senderType === SenderType.ASSISTANT &&
    candidate.channel === conversation.channel &&
    candidate.content === content,
  );
  if (existingPublishedMessage) {
    return {
      messageId: existingPublishedMessage.id,
      conversationId: conversation.id,
      quoteRequestId: quoteRequest.id,
      content: existingPublishedMessage.content,
      channel: existingPublishedMessage.channel,
    };
  }

  const now = dependencies.now();
  const message: Message = {
    id: dependencies.generateId("message"),
    businessId: input.businessId,
    conversationId: conversation.id,
    senderType: SenderType.ASSISTANT,
    channel: conversation.channel,
    content,
    createdAt: now,
  };

  await dependencies.messageRepository.save(message);

  const updatedConversation: Conversation = {
    ...conversation,
    lastMessageAt: now,
  };
  await dependencies.conversationRepository.save(updatedConversation);

  const authorizedPrice = quoteRequest.authorizedPrice;
  if (dependencies.commercialEventRepository !== undefined && authorizedPrice !== undefined) {
    const createEvent = () => {
      const customerId = quoteRequest.customerId ?? conversation.customerId;
      const vehicleId = quoteRequest.vehicleId ?? conversation.vehicleId;
      const event: CommercialEvent = {
        id: dependencies.generateId("commercial-event"),
        businessId: quoteRequest.businessId,
        eventType: CommercialEventType.QUOTE_PUBLISHED,
        conversationId: conversation.id,
        ...(customerId !== undefined ? { customerId } : {}),
        ...(vehicleId !== undefined ? { vehicleId } : {}),
        opportunityId: quoteRequest.opportunityId,
        quoteRequestId: quoteRequest.id,
        requestedItem: quoteRequest.requestDescription,
        ...(quoteRequest.symptomDescription !== undefined
          ? { symptom: quoteRequest.symptomDescription }
          : {}),
        amount: authorizedPrice,
        channel: conversation.channel,
        occurredAt: message.createdAt,
      };
      return event;
    };
    if (dependencies.strictCommercialEventPersistence) {
      await dependencies.commercialEventRepository.append(createEvent());
    } else {
      await appendCommercialEventSafely(dependencies.commercialEventRepository, createEvent);
    }
  }

  return {
    messageId: message.id,
    conversationId: conversation.id,
    quoteRequestId: quoteRequest.id,
    content: message.content,
    channel: message.channel,
  };
}
