import OpenAI from "openai";
import { OpenAIMessageInterpreter } from "../../src/integrations/openai-message-interpreter.js";
import {
  InMemoryAppointmentRepository,
  InMemoryConversationRepository,
  InMemoryCustomerRepository,
  InMemoryHumanHandoffRepository,
  InMemoryMessageRepository,
  InMemoryOpportunityRepository,
  InMemoryQuoteRequestRepository,
  InMemoryVehicleRepository,
} from "../../src/core/in-memory-repositories.js";
import { processMessage } from "../../src/core/process-message.js";
import { Channel, ConversationStatus } from "../../src/core/domain/enums.js";

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  if (!model) {
    throw new Error("OPENAI_MODEL is required");
  }

  const client = new OpenAI({
    apiKey,
  });
  const interpreter = new OpenAIMessageInterpreter(client, model);

  const conversationRepository = new InMemoryConversationRepository();
  const customerRepository = new InMemoryCustomerRepository();
  const messageRepository = new InMemoryMessageRepository();
  const humanHandoffRepository = new InMemoryHumanHandoffRepository();
  const opportunityRepository = new InMemoryOpportunityRepository();
  const quoteRequestRepository = new InMemoryQuoteRequestRepository();
  const appointmentRepository = new InMemoryAppointmentRepository();
  const vehicleRepository = new InMemoryVehicleRepository();

  const timestamp = new Date().toISOString();
  await conversationRepository.save({
    id: "smoke-conversation",
    businessId: "smoke-business",
    channel: Channel.WEB,
    status: ConversationStatus.ACTIVE,
    startedAt: timestamp,
    lastMessageAt: timestamp,
  });

  const idCounters: Record<string, number> = {};
  const generateId = (prefix: string): string => {
    idCounters[prefix] = (idCounters[prefix] ?? 0) + 1;
    return `${prefix}-${idCounters[prefix]}`;
  };

  const result = await processMessage(
    {
      businessId: "smoke-business",
      conversationId: "smoke-conversation",
      content: "Tenho um Corolla 2020 e quero orçamento para trocar as pastilhas de freio.",
    },
    {
      conversationRepository,
      customerRepository,
      messageRepository,
      humanHandoffRepository,
      opportunityRepository,
      quoteRequestRepository,
      appointmentRepository,
      vehicleRepository,
      interpreter,
      now: () => timestamp,
      generateId,
    },
  );

  const conversation = await conversationRepository.findById(
    "smoke-business",
    "smoke-conversation",
  );
  const messages = await messageRepository.listByConversation(
    "smoke-business",
    "smoke-conversation",
  );
  const opportunity = await opportunityRepository.findById(
    "smoke-business",
    "opportunity-1",
  );
  const quoteRequest = await quoteRequestRepository.findById(
    "smoke-business",
    "quote-1",
  );
  const handoff = await humanHandoffRepository.findById(
    "smoke-business",
    "handoff-1",
  );

  console.log(JSON.stringify({
    result,
    conversation,
    messages,
    opportunity,
    quoteRequest,
    handoff,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(
    "Smoke test failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
