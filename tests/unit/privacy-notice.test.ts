import assert from "node:assert/strict";
import test from "node:test";
import { BusinessType, Channel, ConversationStatus, Intent, SenderType } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import {
  InMemoryAppointmentRepository, InMemoryAutomotiveBusinessRepository, InMemoryConversationRepository, InMemoryCustomerRepository,
  InMemoryHumanHandoffRepository, InMemoryMessageRepository, InMemoryOpportunityRepository, InMemoryQuoteRequestRepository, InMemoryVehicleRepository,
} from "../../src/core/in-memory-repositories.js";
import { PRIVACY_NOTICE_PREFIX, processMessage, type ProcessMessageDependencies } from "../../src/core/process-message.js";
import { LlmGuard } from "../../src/core/llm-guard.js";
import { LLM_FAILURE_REPLY, LLM_LIMITED_REPLY } from "../../src/core/response-policy.js";

const at = "2026-01-01T12:00:00.000Z";
const businessId = "business-a";
const interpretation: AIInterpretation = {
  intent: Intent.GENERAL_INFORMATION, extractedCustomerData: {}, extractedVehicleData: {}, missingData: [],
  suggestedNextAction: { type: "NONE", description: "x" }, requiresHuman: false, proposedResponse: "Fazemos troca de óleo.",
};

async function createHarness(options: { publicOrigin?: string; interpret?: () => Promise<AIInterpretation>; limited?: boolean } = {}) {
  const conversationRepository = new InMemoryConversationRepository();
  const customerRepository = new InMemoryCustomerRepository();
  const messageRepository = new InMemoryMessageRepository();
  const businessRepository = new InMemoryAutomotiveBusinessRepository();
  let sequence = 0;
  await businessRepository.save({ id: businessId, name: "Auto Silva", businessType: BusinessType.WORKSHOP, timezone: "UTC", active: true, createdAt: at, updatedAt: at });
  await customerRepository.save({ id: "customer-1", businessId, name: "Maria", createdAt: at, updatedAt: at });
  const open = async (id: string, customerId: string | undefined = "customer-1") => conversationRepository.save({
    id, businessId, ...(customerId === undefined ? {} : { customerId }), channel: Channel.WHATSAPP, status: ConversationStatus.ACTIVE, startedAt: at, lastMessageAt: at,
  });
  await open("conversation-1");
  const dependencies: ProcessMessageDependencies = {
    conversationRepository, customerRepository, messageRepository, businessRepository,
    appointmentRepository: new InMemoryAppointmentRepository(), humanHandoffRepository: new InMemoryHumanHandoffRepository(),
    opportunityRepository: new InMemoryOpportunityRepository(), quoteRequestRepository: new InMemoryQuoteRequestRepository(), vehicleRepository: new InMemoryVehicleRepository(),
    interpreter: { interpret: options.interpret ?? (async () => interpretation) },
    ...(options.limited ? { llmGuard: new LlmGuard({ now: () => at, dailyCallsPerBusiness: 1, countCallsSince: async () => 1 }) } : {}),
    ...(options.publicOrigin === undefined ? {} : { publicOrigin: options.publicOrigin }),
    now: () => at,
    generateId: (prefix) => `${prefix}-${++sequence}`,
  };
  const say = (conversationId = "conversation-1", content = "Oi") => processMessage({ businessId, conversationId, content }, dependencies);
  return { dependencies, customerRepository, messageRepository, open, say };
}

test("the first reply to a customer opens with who is answering, the data use and the privacy link, and only that one", async () => {
  const { say, customerRepository, messageRepository } = await createHarness({ publicOrigin: "https://atendente.example.com/" });
  const first = await say();
  assert.equal(
    first.reply,
    "Olá! Sou o assistente virtual da oficina Auto Silva. Seus dados são tratados para o seu atendimento. Saiba mais em https://atendente.example.com/privacidade.\n\nFazemos troca de óleo.",
  );
  assert.equal((await say()).reply, "Fazemos troca de óleo.");
  assert.equal((await customerRepository.findById(businessId, "customer-1"))?.privacyNoticeAt, at);
  const stored = (await messageRepository.listByConversation(businessId, "conversation-1")).filter(({ senderType }) => senderType === SenderType.ASSISTANT);
  assert.deepEqual(stored.map(({ content }) => content.startsWith(PRIVACY_NOTICE_PREFIX)), [true, false]);
});

test("a new conversation of the same customer, after the idle closing, does not repeat it, but another customer still gets it", async () => {
  const { say, open, customerRepository } = await createHarness({ publicOrigin: "https://atendente.example.com" });
  await say();
  await open("conversation-2");
  assert.equal((await say("conversation-2")).reply, "Fazemos troca de óleo.");
  await customerRepository.save({ id: "customer-2", businessId, createdAt: at, updatedAt: at });
  await open("conversation-3", "customer-2");
  assert.equal((await say("conversation-3")).reply.startsWith(PRIVACY_NOTICE_PREFIX), true);
});

test("a conversation without a customer record gets it once, from its own history", async () => {
  const { say, open } = await createHarness({ publicOrigin: "https://atendente.example.com" });
  await open("conversation-9", undefined);
  assert.equal((await say("conversation-9")).reply.startsWith(PRIVACY_NOTICE_PREFIX), true);
  assert.equal((await say("conversation-9")).reply, "Fazemos troca de óleo.");
});

test("the fixed texts carry it too: the failure text and the limit text each start with the notice on first contact", async () => {
  const failing = await createHarness({ publicOrigin: "https://atendente.example.com", interpret: async () => { throw new Error("provider down"); } });
  const failure = (await failing.say()).reply;
  assert.equal(failure.startsWith(PRIVACY_NOTICE_PREFIX), true);
  assert.equal(failure.endsWith(LLM_FAILURE_REPLY), true);

  const limited = await createHarness({ publicOrigin: "https://atendente.example.com", limited: true });
  const limit = (await limited.say()).reply;
  assert.equal(limit.startsWith(PRIVACY_NOTICE_PREFIX), true);
  assert.equal(limit.includes(LLM_LIMITED_REPLY), true);
  assert.equal((await limited.say()).silenced, true);
});

test("without a public origin there is no link to give, so the replies stay as they were", async () => {
  const { say } = await createHarness();
  assert.equal((await say()).reply, "Fazemos troca de óleo.");
});
