import assert from "node:assert/strict";
import test from "node:test";
import {
  Channel,
  CommercialOutcome,
  ConversationStatus,
  HandoffReason,
  HandoffStatus,
  Intent,
  SenderType,
} from "../../src/core/domain/enums.js";
import type { Conversation, HumanHandoff } from "../../src/core/domain/entities.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import {
  InMemoryConversationRepository,
  InMemoryHumanHandoffRepository,
  InMemoryMessageRepository,
} from "../../src/core/in-memory-repositories.js";
import type { MessageInterpreter } from "../../src/core/message-interpreter.js";
import { processMessage } from "../../src/core/process-message.js";

const timestamp = "2026-01-01T12:00:00.000Z";

const makeConversation = (
  overrides: Partial<Conversation> = {},
): Conversation => ({
  id: "conversation-1",
  businessId: "business-a",
  channel: Channel.WEB,
  status: ConversationStatus.ACTIVE,
  startedAt: timestamp,
  lastMessageAt: timestamp,
  ...overrides,
});

const makeInterpretation = (
  overrides: Partial<AIInterpretation> = {},
): AIInterpretation => ({
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: {},
  extractedVehicleData: {},
  missingData: [],
  suggestedNextAction: { type: "NONE", description: "Nenhuma ação" },
  requiresHuman: false,
  proposedResponse: "Posso ajudar com essa solicitação.",
  ...overrides,
});

const createHarness = (
  interpretation = makeInterpretation(),
  initialConversation = makeConversation(),
) => {
  const conversationRepository = new InMemoryConversationRepository();
  const messageRepository = new InMemoryMessageRepository();
  const humanHandoffRepository = new InMemoryHumanHandoffRepository();
  void conversationRepository.save(initialConversation);

  let id = 0;
  const interpreterInputs: Parameters<MessageInterpreter["interpret"]>[0][] = [];
  const interpreter: MessageInterpreter = {
    async interpret(input) {
      interpreterInputs.push(input);
      return interpretation;
    },
  };

  return {
    conversationRepository,
    messageRepository,
    humanHandoffRepository,
    interpreterInputs,
    dependencies: {
      conversationRepository,
      messageRepository,
      humanHandoffRepository,
      interpreter,
      now: () => timestamp,
      generateId: (prefix: string) => `${prefix}-${++id}`,
    },
  };
};

test("processes a normal message and saves customer and assistant messages", async () => {
  const interpretation = makeInterpretation({
    proposedResponse: "Resposta proposta.",
  });
  const harness = createHarness(interpretation);

  const result = await processMessage(
    {
      businessId: "business-a",
      conversationId: "conversation-1",
      content: "Preciso de ajuda.",
    },
    harness.dependencies,
  );
  const messages = await harness.messageRepository.listByConversation(
    "business-a",
    "conversation-1",
  );

  assert.equal(result.reply, "Resposta proposta.");
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.senderType, SenderType.CUSTOMER);
  assert.equal(messages[0]?.content, "Preciso de ajuda.");
  assert.equal(messages[1]?.senderType, SenderType.ASSISTANT);
  assert.equal(messages[1]?.content, "Resposta proposta.");
});

test("updates the Conversation currentIntent", async () => {
  const harness = createHarness(
    makeInterpretation({ intent: Intent.SERVICE_INQUIRY }),
  );

  await processMessage(
    {
      businessId: "business-a",
      conversationId: "conversation-1",
      content: "Vocês oferecem esse serviço?",
    },
    harness.dependencies,
  );

  const updated = await harness.conversationRepository.findById(
    "business-a",
    "conversation-1",
  );
  assert.equal(updated?.currentIntent, Intent.SERVICE_INQUIRY);
});

test("creates a customer-request handoff for HUMAN_REQUEST", async () => {
  const harness = createHarness(
    makeInterpretation({ intent: Intent.HUMAN_REQUEST }),
  );

  const result = await processMessage(
    {
      businessId: "business-a",
      conversationId: "conversation-1",
      content: "Quero falar com uma pessoa.",
    },
    harness.dependencies,
  );

  const updated = await harness.conversationRepository.findById(
    "business-a",
    "conversation-1",
  );
  const handoff = (await harness.humanHandoffRepository.findById(
    "business-a",
    "handoff-2",
  )) as HumanHandoff | null;

  assert.equal(result.requiresHuman, true);
  assert.equal(updated?.status, ConversationStatus.WAITING_HUMAN);
  assert.equal(updated?.commercialOutcome, CommercialOutcome.HUMAN_HANDOFF);
  assert.equal(handoff?.reason, HandoffReason.CUSTOMER_REQUEST);
  assert.equal(handoff?.status, HandoffStatus.REQUESTED);
});

test("does not process a Conversation through another business", async () => {
  const harness = createHarness();

  await assert.rejects(
    processMessage(
      {
        businessId: "business-b",
        conversationId: "conversation-1",
        content: "Mensagem.",
      },
      harness.dependencies,
    ),
    { message: "Conversation not found" },
  );
});

test("provides the current customer Message in interpreter history", async () => {
  const harness = createHarness();

  await processMessage(
    {
      businessId: "business-a",
      conversationId: "conversation-1",
      content: "Esta mensagem deve estar no histórico.",
    },
    harness.dependencies,
  );

  const history = harness.interpreterInputs[0]?.history;
  assert.equal(history?.length, 1);
  assert.equal(history?.[0]?.senderType, SenderType.CUSTOMER);
  assert.equal(history?.[0]?.content, "Esta mensagem deve estar no histórico.");
});
