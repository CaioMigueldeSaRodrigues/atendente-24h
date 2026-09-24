import type { Conversation, Message } from "./domain/entities.js";
import { SenderType } from "./domain/enums.js";
import { buildAuthorizedQuoteReply } from "./quote-presentation.js";
import type {
  ConversationRepository,
  MessageRepository,
  QuoteRequestRepository,
} from "./repositories.js";

export type PublishAuthorizedQuoteInput = {
  businessId: string;
  quoteRequestId: string;
};

export type PublishAuthorizedQuoteDependencies = {
  quoteRequestRepository: QuoteRequestRepository;
  conversationRepository: ConversationRepository;
  messageRepository: MessageRepository;
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

  return {
    messageId: message.id,
    conversationId: conversation.id,
    quoteRequestId: quoteRequest.id,
    content: message.content,
    channel: message.channel,
  };
}
