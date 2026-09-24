import assert from "node:assert/strict";
import test from "node:test";
import type { Conversation, QuoteRequest } from "../../src/core/domain/entities.js";
import {
  Channel,
  CommercialOutcome,
  ConversationStatus,
  Intent,
  QuoteRequestStatus,
  SenderType,
} from "../../src/core/domain/enums.js";
import {
  InMemoryConversationRepository,
  InMemoryMessageRepository,
  InMemoryQuoteRequestRepository,
} from "../../src/core/in-memory-repositories.js";
import { publishAuthorizedQuote } from "../../src/core/publish-authorized-quote.js";

const timestamp = "2026-01-01T12:00:00.000Z";
const publishedAt = "2026-01-02T12:00:00.000Z";

const makeConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: "conversation-1",
  businessId: "business-1",
  customerId: "customer-1",
  vehicleId: "vehicle-1",
  channel: Channel.WHATSAPP,
  status: ConversationStatus.ACTIVE,
  currentIntent: Intent.QUOTE_REQUEST,
  commercialOutcome: CommercialOutcome.QUOTE_REQUESTED,
  startedAt: "2025-12-31T12:00:00.000Z",
  lastMessageAt: timestamp,
  ...overrides,
});

const makeQuoteRequest = (overrides: Partial<QuoteRequest> = {}): QuoteRequest => ({
  id: "quote-1",
  businessId: "business-1",
  opportunityId: "opportunity-1",
  conversationId: "conversation-1",
  requestDescription: "Pastilhas de freio",
  status: QuoteRequestStatus.RESPONDED,
  requestedAt: "2025-12-30T12:00:00.000Z",
  createdAt: "2025-12-30T12:00:00.000Z",
  updatedAt: timestamp,
  authorizedPrice: { amountCents: 12500, currency: "BRL" },
  ...overrides,
});

const setup = async ({
  quoteRequest = makeQuoteRequest(),
  conversation = makeConversation(),
}: {
  quoteRequest?: QuoteRequest;
  conversation?: Conversation | null;
} = {}) => {
  const quoteRequestRepository = new InMemoryQuoteRequestRepository();
  const conversationRepository = new InMemoryConversationRepository();
  const messageRepository = new InMemoryMessageRepository();
  await quoteRequestRepository.save(quoteRequest);
  if (conversation) {
    await conversationRepository.save(conversation);
  }

  return {
    quoteRequestRepository,
    conversationRepository,
    messageRepository,
    dependencies: {
      quoteRequestRepository,
      conversationRepository,
      messageRepository,
      generateId: (prefix: string) => `${prefix}-generated`,
      now: () => publishedAt,
    },
  };
};

const input = (overrides: Partial<{
  businessId: string;
  quoteRequestId: string;
}> = {}) => ({
  businessId: "business-1",
  quoteRequestId: "quote-1",
  ...overrides,
});

test("persists the authorized quote as an assistant Message", async () => {
  const harness = await setup();

  await publishAuthorizedQuote(input(), harness.dependencies);

  const [message] = await harness.messageRepository.listByConversation(
    "business-1",
    "conversation-1",
  );
  assert.ok(message);
  assert.equal(message.senderType, SenderType.ASSISTANT);
  assert.equal(message.channel, Channel.WHATSAPP);
  assert.equal(
    message.content,
    "O orçamento autorizado é de R$ 125,00. Deseja prosseguir?",
  );
  assert.equal(message.createdAt, publishedAt);
});

test("uses the authorized price stored on the QuoteRequest", async () => {
  const harness = await setup({
    quoteRequest: makeQuoteRequest({
      authorizedPrice: { amountCents: 987654, currency: "BRL" },
    }),
  });

  const result = await publishAuthorizedQuote(input(), harness.dependencies);

  assert.equal(
    result.content,
    "O orçamento autorizado é de R$ 9.876,54. Deseja prosseguir?",
  );
});

test("updates lastMessageAt and preserves other Conversation state", async () => {
  const originalConversation = makeConversation();
  const harness = await setup({ conversation: originalConversation });

  await publishAuthorizedQuote(input(), harness.dependencies);

  const conversation = await harness.conversationRepository.findById(
    "business-1",
    "conversation-1",
  );
  assert.deepEqual(conversation, {
    ...originalConversation,
    lastMessageAt: publishedAt,
  });
  assert.equal(conversation?.customerId, "customer-1");
  assert.equal(conversation?.vehicleId, "vehicle-1");
  assert.equal(conversation?.status, ConversationStatus.ACTIVE);
  assert.equal(conversation?.currentIntent, Intent.QUOTE_REQUEST);
  assert.equal(conversation?.commercialOutcome, CommercialOutcome.QUOTE_REQUESTED);
});

test("returns channel delivery data for the saved Message", async () => {
  const harness = await setup();

  const result = await publishAuthorizedQuote(input(), harness.dependencies);

  assert.deepEqual(result, {
    messageId: "message-generated",
    conversationId: "conversation-1",
    quoteRequestId: "quote-1",
    content: "O orçamento autorizado é de R$ 125,00. Deseja prosseguir?",
    channel: Channel.WHATSAPP,
  });
});

test("rejects a missing QuoteRequest", async () => {
  const harness = await setup();

  await assert.rejects(
    publishAuthorizedQuote(input({ quoteRequestId: "missing" }), harness.dependencies),
    { message: "QuoteRequest not found" },
  );
});

test("does not access a QuoteRequest from another business", async () => {
  const harness = await setup();

  await assert.rejects(
    publishAuthorizedQuote(input({ businessId: "business-2" }), harness.dependencies),
    { message: "QuoteRequest not found" },
  );
  assert.deepEqual(
    await harness.messageRepository.listByConversation("business-1", "conversation-1"),
    [],
  );
});

test("rejects a missing Conversation", async () => {
  const harness = await setup({ conversation: null });

  await assert.rejects(
    publishAuthorizedQuote(input(), harness.dependencies),
    { message: "Conversation not found" },
  );
  assert.deepEqual(
    await harness.messageRepository.listByConversation("business-1", "conversation-1"),
    [],
  );
});

test("propagates the authorization error without changing the QuoteRequest", async () => {
  const quoteRequest = makeQuoteRequest({
    status: QuoteRequestStatus.WAITING_BUSINESS,
  });
  const originalQuoteRequest = structuredClone(quoteRequest);
  const harness = await setup({ quoteRequest });

  await assert.rejects(
    publishAuthorizedQuote(input(), harness.dependencies),
    { message: "Authorized price cannot be presented" },
  );

  assert.deepEqual(
    await harness.quoteRequestRepository.findById("business-1", "quote-1"),
    originalQuoteRequest,
  );
  assert.deepEqual(
    await harness.messageRepository.listByConversation("business-1", "conversation-1"),
    [],
  );
});

test("does not modify any QuoteRequest field", async () => {
  const quoteRequest = makeQuoteRequest();
  const originalQuoteRequest = structuredClone(quoteRequest);
  const harness = await setup({ quoteRequest });

  await publishAuthorizedQuote(input(), harness.dependencies);

  assert.deepEqual(
    await harness.quoteRequestRepository.findById("business-1", "quote-1"),
    originalQuoteRequest,
  );
});
