import assert from "node:assert/strict";
import test from "node:test";
import {
  AppointmentStatus,
  Channel,
  CommercialOutcome,
  ConversationStatus,
  HandoffReason,
  HandoffStatus,
  Intent,
  OpportunityStatus,
  QuoteRequestStatus,
  SenderType,
} from "../../src/core/domain/enums.js";
import type {
  Appointment,
  Conversation,
  HumanHandoff,
  Opportunity,
  QuoteRequest,
} from "../../src/core/domain/entities.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import {
  InMemoryAppointmentRepository,
  InMemoryConversationRepository,
  InMemoryHumanHandoffRepository,
  InMemoryMessageRepository,
  InMemoryOpportunityRepository,
  InMemoryQuoteRequestRepository,
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
  const appointmentRepository = new InMemoryAppointmentRepository();
  const messageRepository = new InMemoryMessageRepository();
  const humanHandoffRepository = new InMemoryHumanHandoffRepository();
  const opportunityRepository = new InMemoryOpportunityRepository();
  const quoteRequestRepository = new InMemoryQuoteRequestRepository();
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
    appointmentRepository,
    messageRepository,
    humanHandoffRepository,
    opportunityRepository,
    quoteRequestRepository,
    interpreterInputs,
    dependencies: {
      conversationRepository,
      appointmentRepository,
      messageRepository,
      humanHandoffRepository,
      opportunityRepository,
      quoteRequestRepository,
      interpreter,
      now: () => timestamp,
      generateId: (prefix: string) => `${prefix}-${++id}`,
    },
  };
};

const seedQuotePair = async (
  harness: ReturnType<typeof createHarness>,
  opportunityStatus: OpportunityStatus,
  quoteRequestStatus: QuoteRequestStatus,
) => {
  const opportunity: Opportunity = {
    id: "opportunity-existing",
    businessId: "business-a",
    conversationId: "conversation-1",
    requestDescription: "Pastilhas de freio",
    status: opportunityStatus,
    nextAction: {
      type: "REQUEST_INFORMATION",
      description: "Aguardar dados do cliente.",
    },
    createdAt: "2025-12-31T12:00:00.000Z",
    updatedAt: "2025-12-31T12:00:00.000Z",
  };
  const quoteRequest: QuoteRequest = {
    id: "quote-existing",
    businessId: "business-a",
    conversationId: "conversation-1",
    opportunityId: opportunity.id,
    requestDescription: "Pastilhas de freio",
    symptomDescription: "Ruído ao frear",
    status: quoteRequestStatus,
    requestedAt: "2025-12-31T12:00:00.000Z",
    createdAt: "2025-12-31T12:00:00.000Z",
    updatedAt: "2025-12-31T12:00:00.000Z",
  };
  await harness.opportunityRepository.save(opportunity);
  await harness.quoteRequestRepository.save(quoteRequest);
  return { opportunity, quoteRequest };
};

const runQuoteRequest = async (
  interpretationOverrides: Partial<AIInterpretation> = {},
  content = "Quero solicitar um orçamento.",
) => {
  const harness = createHarness(
    makeInterpretation({ intent: Intent.QUOTE_REQUEST, ...interpretationOverrides }),
  );
  const result = await processMessage(
    {
      businessId: "business-a",
      conversationId: "conversation-1",
      content,
    },
    harness.dependencies,
  );
  return { harness, result };
};

const processQuoteOnHarness = (
  harness: ReturnType<typeof createHarness>,
  content = "Quero solicitar um orçamento.",
) => processMessage(
  {
    businessId: "business-a",
    conversationId: "conversation-1",
    content,
  },
  harness.dependencies,
);

const runAppointmentRequest = async (
  interpretationOverrides: Partial<AIInterpretation> = {},
  content = "Quero solicitar um agendamento.",
) => {
  const harness = createHarness(
    makeInterpretation({
      intent: Intent.APPOINTMENT_REQUEST,
      ...interpretationOverrides,
    }),
  );
  const result = await processMessage(
    {
      businessId: "business-a",
      conversationId: "conversation-1",
      content,
    },
    harness.dependencies,
  );
  return { harness, result };
};

test("processes a normal message and saves customer and assistant messages", async () => {
  const interpretation = makeInterpretation({
    intent: Intent.GENERAL_INFORMATION,
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

test("QUOTE_REQUEST creates an Opportunity", async () => {
  const { harness } = await runQuoteRequest();
  const opportunity = (await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-2",
  )) as Opportunity | null;

  assert.ok(opportunity);
  assert.equal(opportunity.businessId, "business-a");
  assert.equal(opportunity.conversationId, "conversation-1");
});

test("QUOTE_REQUEST Opportunity waits for the business", async () => {
  const { harness } = await runQuoteRequest();
  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-2",
  );

  assert.equal(opportunity?.status, OpportunityStatus.WAITING_BUSINESS);
});

test("QUOTE_REQUEST creates a QuoteRequest linked to its Opportunity", async () => {
  const { harness } = await runQuoteRequest();
  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-2",
  );
  const quoteRequest = (await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-3",
  )) as QuoteRequest | null;

  assert.ok(quoteRequest);
  assert.equal(quoteRequest.opportunityId, opportunity?.id);
});

test("QUOTE_REQUEST QuoteRequest waits for the business", async () => {
  const { harness } = await runQuoteRequest();
  const quoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-3",
  );

  assert.equal(quoteRequest?.status, QuoteRequestStatus.WAITING_BUSINESS);
});

test("QUOTE_REQUEST with REQUEST_INFORMATION waits for the customer", async () => {
  const { harness } = await runQuoteRequest({
    missingData: ["brand", "version"],
    suggestedNextAction: {
      type: "REQUEST_INFORMATION",
      description: "Solicitar dados do veículo.",
    },
  });
  const [opportunity] = await harness.opportunityRepository.listByConversation(
    "business-a",
    "conversation-1",
  );
  const [quoteRequest] = await harness.quoteRequestRepository.listByConversation(
    "business-a",
    "conversation-1",
  );

  assert.equal(opportunity?.status, OpportunityStatus.WAITING_CUSTOMER);
  assert.equal(quoteRequest?.status, QuoteRequestStatus.WAITING_INFORMATION);
});

test("QUOTE_REQUEST without REQUEST_INFORMATION waits for the business", async () => {
  const { harness } = await runQuoteRequest({
    suggestedNextAction: {
      type: "PROVIDE_QUOTE",
      description: "Preparar orçamento.",
    },
  });
  const [opportunity] = await harness.opportunityRepository.listByConversation(
    "business-a",
    "conversation-1",
  );
  const [quoteRequest] = await harness.quoteRequestRepository.listByConversation(
    "business-a",
    "conversation-1",
  );

  assert.equal(opportunity?.status, OpportunityStatus.WAITING_BUSINESS);
  assert.equal(quoteRequest?.status, QuoteRequestStatus.WAITING_BUSINESS);
});

test("QUOTE_REQUEST updates the Conversation commercial outcome", async () => {
  const { harness } = await runQuoteRequest();
  const conversation = await harness.conversationRepository.findById(
    "business-a",
    "conversation-1",
  );

  assert.equal(conversation?.commercialOutcome, CommercialOutcome.QUOTE_REQUESTED);
});

test("uses requestedItem as the request description when provided", async () => {
  const { harness } = await runQuoteRequest({ requestedItem: "Pastilhas de freio" });
  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-2",
  );
  const quoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-3",
  );

  assert.equal(opportunity?.requestDescription, "Pastilhas de freio");
  assert.equal(quoteRequest?.requestDescription, "Pastilhas de freio");
});

test("uses the customer's original content when requestedItem is absent", async () => {
  const content = "Quero orçamento para trocar os pneus.";
  const { harness } = await runQuoteRequest({}, content);
  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-2",
  );
  const quoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-3",
  );

  assert.equal(opportunity?.requestDescription, content);
  assert.equal(quoteRequest?.requestDescription, content);
});

test("QUOTE_REQUEST with human handoff records both and prioritizes handoff state", async () => {
  const { harness, result } = await runQuoteRequest({
    requiresHuman: true,
    handoffReason: HandoffReason.LOW_CONFIDENCE,
  });
  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-2",
  );
  const quoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-3",
  );
  const handoff = await harness.humanHandoffRepository.findById(
    "business-a",
    "handoff-4",
  );
  const conversation = await harness.conversationRepository.findById(
    "business-a",
    "conversation-1",
  );

  assert.ok(opportunity);
  assert.ok(quoteRequest);
  assert.ok(handoff);
  assert.equal(result.requiresHuman, true);
  assert.equal(conversation?.status, ConversationStatus.WAITING_HUMAN);
  assert.equal(conversation?.commercialOutcome, CommercialOutcome.HUMAN_HANDOFF);
});

test("QUOTE_REQUEST saves the safe response instead of proposedResponse", async () => {
  const { harness, result } = await runQuoteRequest({
    proposedResponse: "O valor é R$ 500.",
  });
  const messages = await harness.messageRepository.listByConversation(
    "business-a",
    "conversation-1",
  );

  assert.equal(
    result.reply,
    "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.",
  );
  assert.equal(messages[1]?.content, result.reply);
});

test("QUOTE_REQUEST requests missing customer data without human handoff", async () => {
  const { harness, result } = await runQuoteRequest({
    missingData: ["brand", "version", "licensePlate", "mileage"],
    suggestedNextAction: {
      type: "REQUEST_INFORMATION",
      description: "Solicitar dados faltantes do veículo.",
    },
    requiresHuman: false,
    proposedResponse: "O orçamento custa R$ 500.",
  });
  const messages = await harness.messageRepository.listByConversation(
    "business-a",
    "conversation-1",
  );
  const conversation = await harness.conversationRepository.findById(
    "business-a",
    "conversation-1",
  );
  const handoff = await harness.humanHandoffRepository.findById(
    "business-a",
    "handoff-4",
  );

  assert.equal(
    messages[1]?.content,
    "Para preparar o orçamento, preciso de mais algumas informações: marca e versão. Pode me informar?",
  );
  assert.equal(result.requiresHuman, false);
  assert.equal(handoff, null);
  assert.equal(conversation?.commercialOutcome, CommercialOutcome.QUOTE_REQUESTED);
});

test("continues the latest active Opportunity and linked QuoteRequest without duplicates", async () => {
  const harness = createHarness(makeInterpretation({
    suggestedNextAction: {
      type: "REQUEST_INFORMATION",
      description: "Solicitar dados adicionais.",
    },
    requestedItem: "Pastilhas de freio para Corolla",
  }));
  const seeded = await seedQuotePair(
    harness,
    OpportunityStatus.WAITING_CUSTOMER,
    QuoteRequestStatus.WAITING_INFORMATION,
  );

  await processQuoteOnHarness(harness, "É para meu Corolla 2020.");

  const opportunities = await harness.opportunityRepository.listByConversation(
    "business-a",
    "conversation-1",
  );
  const quoteRequests = await harness.quoteRequestRepository.listByConversation(
    "business-a",
    "conversation-1",
  );
  const updatedOpportunity = await harness.opportunityRepository.findById(
    "business-a",
    seeded.opportunity.id,
  );
  const updatedQuoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    seeded.quoteRequest.id,
  );

  assert.equal(opportunities.length, 1);
  assert.equal(quoteRequests.length, 1);
  assert.equal(updatedOpportunity?.id, seeded.opportunity.id);
  assert.equal(updatedQuoteRequest?.id, seeded.quoteRequest.id);
  assert.equal(updatedOpportunity?.createdAt, seeded.opportunity.createdAt);
  assert.equal(updatedQuoteRequest?.createdAt, seeded.quoteRequest.createdAt);
  assert.equal(updatedQuoteRequest?.requestedAt, seeded.quoteRequest.requestedAt);
  assert.equal(updatedOpportunity?.requestDescription, "Pastilhas de freio para Corolla");
  assert.equal(updatedQuoteRequest?.requestDescription, "Pastilhas de freio para Corolla");
  assert.equal(updatedQuoteRequest?.symptomDescription, "Ruído ao frear");
});

test("moves an active quote pair from customer waiting to business waiting", async () => {
  const harness = createHarness(makeInterpretation({
    suggestedNextAction: {
      type: "PROVIDE_QUOTE",
      description: "Preparar o orçamento.",
    },
  }));
  const seeded = await seedQuotePair(
    harness,
    OpportunityStatus.WAITING_CUSTOMER,
    QuoteRequestStatus.WAITING_INFORMATION,
  );

  await processQuoteOnHarness(harness, "A quilometragem é 50000 km.");

  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    seeded.opportunity.id,
  );
  const quoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    seeded.quoteRequest.id,
  );
  assert.equal(opportunity?.status, OpportunityStatus.WAITING_BUSINESS);
  assert.equal(quoteRequest?.status, QuoteRequestStatus.WAITING_BUSINESS);
  assert.deepEqual(opportunity?.nextAction, {
    type: "PROVIDE_QUOTE",
    description: "Preparar o orçamento.",
  });
});

test("does not reuse a closed Opportunity or responded QuoteRequest", async () => {
  const harness = createHarness();
  await seedQuotePair(
    harness,
    OpportunityStatus.CLOSED,
    QuoteRequestStatus.RESPONDED,
  );

  await processQuoteOnHarness(harness);

  const opportunities = await harness.opportunityRepository.listByConversation(
    "business-a",
    "conversation-1",
  );
  const quoteRequests = await harness.quoteRequestRepository.listByConversation(
    "business-a",
    "conversation-1",
  );
  assert.equal(opportunities.length, 2);
  assert.equal(quoteRequests.length, 2);
  assert.equal(opportunities[0]?.id, "opportunity-existing");
  assert.equal(opportunities[0]?.status, OpportunityStatus.CLOSED);
  assert.equal(opportunities[1]?.id, "opportunity-2");
  assert.equal(opportunities[1]?.status, OpportunityStatus.WAITING_BUSINESS);
  assert.equal(quoteRequests[0]?.id, "quote-existing");
  assert.equal(quoteRequests[0]?.status, QuoteRequestStatus.RESPONDED);
  assert.equal(quoteRequests[1]?.id, "quote-3");
  assert.equal(quoteRequests[1]?.status, QuoteRequestStatus.WAITING_BUSINESS);
});

test("APPOINTMENT_REQUEST creates an Appointment", async () => {
  const { harness } = await runAppointmentRequest();
  const appointment = (await harness.appointmentRepository.findById(
    "business-a",
    "appointment-2",
  )) as Appointment | null;

  assert.ok(appointment);
  assert.equal(appointment.businessId, "business-a");
  assert.equal(appointment.conversationId, "conversation-1");
});

test("requested Appointment remains REQUESTED without confirmation time", async () => {
  const { harness } = await runAppointmentRequest();
  const appointment = await harness.appointmentRepository.findById(
    "business-a",
    "appointment-2",
  );

  assert.equal(appointment?.status, AppointmentStatus.REQUESTED);
  assert.equal(
    appointment && Object.hasOwn(appointment, "confirmedStartAt"),
    false,
  );
});

test("APPOINTMENT_REQUEST updates the Conversation commercial outcome", async () => {
  const { harness } = await runAppointmentRequest();
  const conversation = await harness.conversationRepository.findById(
    "business-a",
    "conversation-1",
  );

  assert.equal(
    conversation?.commercialOutcome,
    CommercialOutcome.APPOINTMENT_REQUESTED,
  );
});

test("uses requestedItem as Appointment requestDescription when provided", async () => {
  const { harness } = await runAppointmentRequest({
    requestedItem: "Instalação de para-brisa",
  });
  const appointment = await harness.appointmentRepository.findById(
    "business-a",
    "appointment-2",
  );

  assert.equal(appointment?.requestDescription, "Instalação de para-brisa");
});

test("uses original customer content when Appointment requestedItem is absent", async () => {
  const content = "Quero marcar uma avaliação dos pneus.";
  const { harness } = await runAppointmentRequest({}, content);
  const appointment = await harness.appointmentRepository.findById(
    "business-a",
    "appointment-2",
  );

  assert.equal(appointment?.requestDescription, content);
});

test("APPOINTMENT_REQUEST with human handoff records both and prioritizes handoff", async () => {
  const { harness, result } = await runAppointmentRequest({
    requiresHuman: true,
    handoffReason: HandoffReason.LOW_CONFIDENCE,
  });
  const appointment = await harness.appointmentRepository.findById(
    "business-a",
    "appointment-2",
  );
  const handoff = await harness.humanHandoffRepository.findById(
    "business-a",
    "handoff-3",
  );
  const conversation = await harness.conversationRepository.findById(
    "business-a",
    "conversation-1",
  );

  assert.ok(appointment);
  assert.ok(handoff);
  assert.equal(result.requiresHuman, true);
  assert.equal(conversation?.status, ConversationStatus.WAITING_HUMAN);
  assert.equal(conversation?.commercialOutcome, CommercialOutcome.HUMAN_HANDOFF);
});

test("APPOINTMENT_REQUEST saves the safe response instead of proposedResponse", async () => {
  const { harness, result } = await runAppointmentRequest({
    proposedResponse: "Seu horário está confirmado.",
  });
  const messages = await harness.messageRepository.listByConversation(
    "business-a",
    "conversation-1",
  );

  assert.equal(
    result.reply,
    "Solicitação de agendamento registrada. O horário ainda precisa ser confirmado pela equipe.",
  );
  assert.equal(messages[1]?.content, result.reply);
});

test("HUMAN_REQUEST returns the safe handoff response", async () => {
  const harness = createHarness(
    makeInterpretation({
      intent: Intent.HUMAN_REQUEST,
      proposedResponse: "Vou resolver isso imediatamente.",
    }),
  );

  const result = await processMessage(
    {
      businessId: "business-a",
      conversationId: "conversation-1",
      content: "Quero falar com uma pessoa.",
    },
    harness.dependencies,
  );

  assert.equal(
    result.reply,
    "Vou encaminhar sua solicitação para a equipe responsável.",
  );
});
