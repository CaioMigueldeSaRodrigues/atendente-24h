import OpenAI from "openai";
import { GroqMessageInterpreter } from "../integrations/groq-message-interpreter.js";
import {
  InMemoryAppointmentRepository,
  InMemoryConversationRepository,
  InMemoryCustomerRepository,
  InMemoryHumanHandoffRepository,
  InMemoryMessageRepository,
  InMemoryOpportunityRepository,
  InMemoryQuoteRequestRepository,
  InMemoryVehicleRepository,
} from "../core/in-memory-repositories.js";
import { processMessage } from "../core/process-message.js";
import { Channel, ConversationStatus } from "../core/domain/enums.js";

async function main(): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  if (!model) {
    throw new Error("GROQ_MODEL is required");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
  const interpreter = new GroqMessageInterpreter(client, model);

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

  const dependencies = {
    conversationRepository,
    customerRepository,
    messageRepository,
    humanHandoffRepository,
    opportunityRepository,
    quoteRequestRepository,
    appointmentRepository,
    vehicleRepository,
    interpreter,
    now: () => new Date().toISOString(),
    generateId,
  };

  const turn1 = await processMessage(
    {
      businessId: "smoke-business",
      conversationId: "smoke-conversation",
      content: "Tenho um Corolla 2020 e quero orçamento para trocar as pastilhas de freio.",
    },
    dependencies,
  );

  const turn2 = await processMessage(
    {
      businessId: "smoke-business",
      conversationId: "smoke-conversation",
      content: "É Toyota XEi.",
    },
    dependencies,
  );

  const turn3 = await processMessage(
    {
      businessId: "smoke-business",
      conversationId: "smoke-conversation",
      content: "A placa é ABC1D23 e está com 42 mil km.",
    },
    dependencies,
  );

  const conversation = await conversationRepository.findById(
    "smoke-business",
    "smoke-conversation",
  );
  const messages = await messageRepository.listByConversation(
    "smoke-business",
    "smoke-conversation",
  );
  const opportunities = await opportunityRepository.listByConversation(
    "smoke-business",
    "smoke-conversation",
  );
  const quoteRequests = await quoteRequestRepository.listByConversation(
    "smoke-business",
    "smoke-conversation",
  );
  const vehicle = conversation?.vehicleId
    ? await vehicleRepository.findById("smoke-business", conversation.vehicleId)
    : null;
  const customer = conversation?.customerId
    ? await customerRepository.findById("smoke-business", conversation.customerId)
    : null;
  const handoff = await humanHandoffRepository.findById(
    "smoke-business",
    "handoff-1",
  );

  console.log(JSON.stringify({
    turns: {
      turn1,
      turn2,
      turn3,
    },
    conversation,
    messages,
    opportunities,
    quoteRequests,
    vehicle,
    customer,
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
