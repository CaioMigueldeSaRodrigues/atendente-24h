import assert from "node:assert/strict";
import test from "node:test";
import {
  AppointmentStatus,
  Channel,
  CommercialEventType,
  CommercialOutcome,
  ConversationStatus,
  HandoffReason,
  HandoffStatus,
  Intent,
  OpportunityStatus,
  OutboundDeliveryStatus,
  QuoteDraftStatus,
  QuoteRequestStatus,
  SenderType,
} from "../../src/core/domain/enums.js";
import type {
  Appointment,
  Conversation,
  Customer,
  HumanHandoff,
  Opportunity,
  QuoteRequest,
  Vehicle,
} from "../../src/core/domain/entities.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import {
  InMemoryAppointmentRepository,
  InMemoryBusinessProfileRepository,
  InMemoryConversationRepository,
  InMemoryCommercialEventRepository,
  InMemoryCustomerRepository,
  InMemoryHumanHandoffRepository,
  InMemoryMessageRepository,
  InMemoryOpportunityRepository,
  InMemoryOutboundDeliveryRepository,
  InMemoryQuoteRequestRepository,
  InMemoryVehicleRepository,
} from "../../src/core/in-memory-repositories.js";
import type { MessageInterpreter } from "../../src/core/message-interpreter.js";
import type { BusinessProfile } from "../../src/core/business-profile.js";
import { LlmGuard } from "../../src/core/llm-guard.js";
import { applyInterpretation, interpretCustomerMessage, processMessage, receiveCustomerMessage } from "../../src/core/process-message.js";
import type { QuoteDraft } from "../../src/core/quote-draft.js";
import { HANDOFF_REPLY, LLM_FAILURE_REPLY, LLM_LIMITED_REPLY, QUOTE_LOCKED_REPLY, UNSAFE_REPLY_FALLBACK, UNSUPPORTED_MESSAGE_REPLY } from "../../src/core/response-policy.js";

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
  interpretation: AIInterpretation | readonly AIInterpretation[] = makeInterpretation(),
  initialConversation = makeConversation(),
) => {
  const conversationRepository = new InMemoryConversationRepository();
  const customerRepository = new InMemoryCustomerRepository();
  const appointmentRepository = new InMemoryAppointmentRepository();
  const messageRepository = new InMemoryMessageRepository();
  const humanHandoffRepository = new InMemoryHumanHandoffRepository();
  const opportunityRepository = new InMemoryOpportunityRepository();
  const quoteRequestRepository = new InMemoryQuoteRequestRepository();
  const commercialEventRepository = new InMemoryCommercialEventRepository();
  const vehicleRepository = new InMemoryVehicleRepository();
  void conversationRepository.save(initialConversation);

  const idCounters: Record<string, number> = {};
  const interpretationSequence: readonly AIInterpretation[] = Array.isArray(interpretation)
    ? interpretation
    : [interpretation as AIInterpretation];
  let interpretationIndex = 0;
  const interpreterInputs: Parameters<MessageInterpreter["interpret"]>[0][] = [];
  const interpreter: MessageInterpreter = {
    async interpret(input) {
      interpreterInputs.push(input);
      const result = interpretationSequence[
        Math.min(interpretationIndex, interpretationSequence.length - 1)
      ];
      interpretationIndex += 1;
      if (!result) {
        throw new Error("Missing test interpretation");
      }
      return result;
    },
  };

  return {
    conversationRepository,
    customerRepository,
    appointmentRepository,
    messageRepository,
    humanHandoffRepository,
    opportunityRepository,
    quoteRequestRepository,
    commercialEventRepository,
    vehicleRepository,
    interpreterInputs,
    dependencies: {
      conversationRepository,
      customerRepository,
      appointmentRepository,
      messageRepository,
      humanHandoffRepository,
      opportunityRepository,
      quoteRequestRepository,
      commercialEventRepository,
      vehicleRepository,
      interpreter,
      now: () => timestamp,
      generateId: (prefix: string) => {
        idCounters[prefix] = (idCounters[prefix] ?? 0) + 1;
        return `${prefix}-${idCounters[prefix]}`;
      },
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
    makeInterpretation({
      intent: Intent.QUOTE_REQUEST,
      requestedItem: "Pastilhas de freio",
      extractedVehicleData: {
        brand: "Toyota",
        model: "Corolla",
        year: 2020,
        version: "XEi",
      },
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

for (const scenario of [
  { id: "S01", content: "Olá. Quero orçamento para troca de óleo do meu Onix 2020.", requestedItem: "Troca de óleo", vehicle: { model: "Onix", year: 2020 } },
  { id: "S03", content: "Preciso trocar as pastilhas de freio do Corolla 2021.", requestedItem: "Pastilhas de freio", vehicle: { model: "Corolla", year: 2021 } },
]) {
  test(`${scenario.id}: a disobedient interpreter cannot impose registration requirements`, async () => {
    const { harness, result } = await runQuoteRequest({
      requestedItem: scenario.requestedItem,
      extractedVehicleData: scenario.vehicle,
      missingData: ["placa", "telefone", "quilometragem", "versao", "email", "CPF", "chassi"],
      suggestedNextAction: { type: "REQUEST_INFORMATION", description: "Completar cadastro antes de orçar" },
      proposedResponse: "Informe placa, telefone, quilometragem, versão, e-mail, CPF e chassi. O preço é R$ 500.",
    }, scenario.content);
    assert.equal(result.intent, Intent.QUOTE_REQUEST);
    assert.equal(result.reply, "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.");
    const [quote] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");
    const [opportunity] = await harness.opportunityRepository.listByConversation("business-a", "conversation-1");
    assert.equal(quote?.status, QuoteRequestStatus.WAITING_BUSINESS);
    assert.equal(opportunity?.status, OpportunityStatus.WAITING_BUSINESS);
    assert.equal(opportunity?.nextAction?.type, "PROVIDE_QUOTE");
    assert.equal(quote?.requestDescription, scenario.requestedItem);
    assert.equal((await harness.vehicleRepository.findById("business-a", "vehicle-1"))?.brand, undefined);
    const messages = await harness.messageRepository.listByConversation("business-a", "conversation-1");
    assert.equal(messages[0]?.content, scenario.content);
    assert.equal(messages[1]?.content, result.reply);
    assert.doesNotMatch(result.reply, /\uFFFD|R\$|placa|telefone|quilometragem|versão|CPF|chassi|e-mail/);
  });
}

test("S02: asks only for the absent commercial object even if the model requests a full registration", async () => {
  const { harness, result } = await runQuoteRequest({
    requestedItem: "",
    missingData: ["placa", "telefone", "versão"],
    proposedResponse: "Informe todos os dados cadastrais.",
  }, "Quero orçamento.");
  assert.equal(result.reply, "Qual serviço ou produto você deseja orçar? Pode também descrever o sintoma.");
  assert.equal(result.requiresHuman, false);
  const [quote] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");
  assert.equal(quote?.status, QuoteRequestStatus.WAITING_INFORMATION);
});

test("S04: stores the symptom, preserves diagnostic handoff and never confirms a diagnosis", async () => {
  const symptom = "Barulho metálico ao frear";
  const { harness, result } = await runQuoteRequest({
    requestedItem: "",
    symptomDescription: symptom,
    extractedVehicleData: {},
    requiresHuman: true,
    handoffReason: HandoffReason.DIAGNOSIS_REQUIRED,
    proposedResponse: "O disco de freio está defeituoso.",
  }, "Meu carro está fazendo um barulho metálico ao frear.");
  const [quote] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");
  assert.equal(quote?.symptomDescription, symptom);
  assert.equal(quote?.status, QuoteRequestStatus.WAITING_BUSINESS);
  assert.equal(result.reply, "Vou encaminhar sua solicitação para a equipe responsável.");
  assert.equal((await harness.humanHandoffRepository.findById("business-a", "handoff-1"))?.reason, HandoffReason.DIAGNOSIS_REQUIRED);
});

test("deterministically hands off an explicit technical diagnosis request", async () => {
  const { harness, result } = await runQuoteRequest({
    intent: Intent.SYMPTOM_REPORT,
    requestedItem: "",
    symptomDescription: "Barulho ao frear",
    proposedResponse: "Pode ser o disco.",
  }, "Meu carro faz um barulho quando eu freio. O que pode ser?");

  assert.equal(result.requiresHuman, true);
  assert.match(result.reply, /encaminhar/i);
  assert.equal((await harness.humanHandoffRepository.findById("business-a", "handoff-1"))?.reason, HandoffReason.DIAGNOSIS_REQUIRED);
});

test("does not hand off a symptom report that is still collecting information", async () => {
  const { harness, result } = await runQuoteRequest({
    intent: Intent.SYMPTOM_REPORT,
    requestedItem: "",
    symptomDescription: "Barulho ao frear",
    proposedResponse: "Entendi o sintoma.",
  }, "Meu carro faz um barulho quando eu freio.");

  assert.equal(result.requiresHuman, false);
  assert.equal(await harness.humanHandoffRepository.findById("business-a", "handoff-1"), null);
});

test("S05: voluntarily declared contact/plate are stored without making them required in another conversation", async () => {
  const harness = createHarness([
    makeInterpretation({ intent: Intent.GENERAL_INFORMATION, extractedCustomerData: { primaryPhone: "11999999999" }, extractedVehicleData: { licensePlate: "ABC1D23" } }),
    makeInterpretation({ requestedItem: "Troca de óleo", missingData: ["telefone", "placa"], suggestedNextAction: { type: "REQUEST_INFORMATION", description: "Cadastro" } }),
  ]);
  await processQuoteOnHarness(harness, "Meu telefone é 11999999999 e a placa é ABC1D23.");
  assert.equal((await harness.customerRepository.findById("business-a", "customer-1"))?.primaryPhone, "11999999999");
  assert.equal((await harness.vehicleRepository.findById("business-a", "vehicle-1"))?.licensePlate, "ABC1D23");
  await harness.conversationRepository.save(makeConversation({ id: "conversation-2" }));
  const result = await processMessage({ businessId: "business-a", conversationId: "conversation-2", content: "Quero orçamento de troca de óleo." }, harness.dependencies);
  const [quote] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-2");
  assert.equal(quote?.status, QuoteRequestStatus.WAITING_BUSINESS);
  assert.equal((await harness.conversationRepository.findById("business-a", "conversation-2"))?.customerId, undefined);
  assert.equal(result.reply, "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.");
});

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
    "handoff-1",
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
    "opportunity-1",
  )) as Opportunity | null;

  assert.ok(opportunity);
  assert.equal(opportunity.businessId, "business-a");
  assert.equal(opportunity.conversationId, "conversation-1");
});

test("QUOTE_REQUEST Opportunity waits for the business", async () => {
  const { harness } = await runQuoteRequest();
  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-1",
  );

  assert.equal(opportunity?.status, OpportunityStatus.WAITING_BUSINESS);
});

test("QUOTE_REQUEST creates a QuoteRequest linked to its Opportunity", async () => {
  const { harness } = await runQuoteRequest();
  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-1",
  );
  const quoteRequest = (await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-1",
  )) as QuoteRequest | null;

  assert.ok(quoteRequest);
  assert.equal(quoteRequest.opportunityId, opportunity?.id);
});

test("a new QuoteRequest emits one QUOTE_REQUESTED with available vehicle and item data", async () => {
  const { harness } = await runQuoteRequest({
    requestedItem: "Pastilhas de freio",
    symptomDescription: "Ruído ao frear",
  });
  const [event] = await harness.commercialEventRepository.listByBusiness("business-a");
  assert.equal((await harness.commercialEventRepository.listByBusiness("business-a")).length, 1);
  assert.equal(event?.eventType, CommercialEventType.QUOTE_REQUESTED);
  assert.equal(event?.businessId, "business-a");
  assert.equal(event?.conversationId, "conversation-1");
  assert.equal(event?.quoteRequestId, "quote-1");
  assert.equal(event?.opportunityId, "opportunity-1");
  assert.equal(event?.channel, Channel.WEB);
  assert.equal(event?.requestedItem, "Pastilhas de freio");
  assert.equal(event?.symptom, "Ruído ao frear");
  assert.deepEqual({ brand: event?.vehicleBrand, model: event?.vehicleModel, year: event?.vehicleYear }, {
    brand: "Toyota", model: "Corolla", year: 2020,
  });
});

test("continuing an active QuoteRequest does not emit a duplicate QUOTE_REQUESTED", async () => {
  const interpretation = makeInterpretation({
    extractedVehicleData: { brand: "Toyota", model: "Corolla", year: 2020, version: "XEi" },
    requestedItem: "Pastilhas de freio",
  });
  const harness = createHarness([interpretation, interpretation]);
  await processQuoteOnHarness(harness);
  await processQuoteOnHarness(harness, "Complementando os dados do mesmo pedido.");
  assert.deepEqual(
    (await harness.commercialEventRepository.listByConversation("business-a", "conversation-1"))
      .map((event) => [event.eventType, event.quoteRequestId]),
    [[CommercialEventType.QUOTE_REQUESTED, "quote-1"]],
  );
});

test("QUOTE_REQUEST QuoteRequest waits for the business", async () => {
  const { harness } = await runQuoteRequest();
  const quoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-1",
  );

  assert.equal(quoteRequest?.status, QuoteRequestStatus.WAITING_BUSINESS);
});

test("QUOTE_REQUEST without a commercial object waits for the customer", async () => {
  const { harness } = await runQuoteRequest({
    requestedItem: "",
    extractedVehicleData: { model: "Corolla", year: 2020 },
    missingData: ["licensePlate", "mileage", "name", "primaryPhone", "email"],
    suggestedNextAction: {
      type: "PROVIDE_QUOTE",
      description: "A IA sugeriu fornecer orçamento.",
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

test("ignores model missingData and suggestedNextAction when a commercial object exists", async () => {
  const { harness, result } = await runQuoteRequest({
    extractedVehicleData: {
      brand: "Toyota",
      model: "Corolla",
      year: 2020,
      version: "XEi",
    },
    missingData: ["licensePlate", "mileage", "name", "primaryPhone", "email"],
    suggestedNextAction: {
      type: "REQUEST_INFORMATION",
      description: "A IA sugeriu pedir dados adicionais.",
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
  assert.equal(
    result.reply,
    "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.",
  );
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
    "opportunity-1",
  );
  const quoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-1",
  );

  assert.equal(opportunity?.requestDescription, "Pastilhas de freio");
  assert.equal(quoteRequest?.requestDescription, "Pastilhas de freio");
});

test("uses the customer's original content when requestedItem is absent", async () => {
  const content = "Quero orçamento para trocar os pneus.";
  const { harness } = await runQuoteRequest({ requestedItem: "", symptomDescription: "Pneus desgastados" }, content);
  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-1",
  );
  const quoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-1",
  );

  assert.equal(opportunity?.requestDescription, content);
  assert.equal(quoteRequest?.requestDescription, content);
});

test("QUOTE_REQUEST with human handoff records both and prioritizes handoff state", async () => {
  const { harness, result } = await runQuoteRequest({
    extractedVehicleData: { model: "Corolla", year: 2020 },
    suggestedNextAction: {
      type: "REQUEST_INFORMATION",
      description: "Solicitar informações faltantes.",
    },
    requiresHuman: true,
    handoffReason: HandoffReason.LOW_CONFIDENCE,
  });
  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-1",
  );
  const quoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-1",
  );
  const handoff = await harness.humanHandoffRepository.findById(
    "business-a",
    "handoff-1",
  );
  const conversation = await harness.conversationRepository.findById(
    "business-a",
    "conversation-1",
  );

  assert.ok(opportunity);
  assert.ok(quoteRequest);
  assert.ok(handoff);
  assert.equal(result.requiresHuman, true);
  assert.equal(
    result.reply,
    "Vou encaminhar sua solicitação para a equipe responsável.",
  );
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

test("QUOTE_REQUEST asks only for the commercial object without human handoff", async () => {
  const { harness, result } = await runQuoteRequest({
    requestedItem: "",
    extractedVehicleData: { model: "Corolla", year: 2020 },
    missingData: ["brand", "version", "licensePlate", "mileage"],
    suggestedNextAction: {
      type: "PROVIDE_QUOTE",
      description: "A IA sugeriu fornecer orçamento.",
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
    "handoff-1",
  );
  const opportunity = await harness.opportunityRepository.findById(
    "business-a",
    "opportunity-1",
  );
  const quoteRequest = await harness.quoteRequestRepository.findById(
    "business-a",
    "quote-1",
  );

  assert.equal(
    messages[1]?.content,
    "Qual serviço ou produto você deseja orçar? Pode também descrever o sintoma.",
  );
  assert.equal(result.requiresHuman, false);
  assert.equal(handoff, null);
  assert.equal(opportunity?.status, OpportunityStatus.WAITING_CUSTOMER);
  assert.equal(quoteRequest?.status, QuoteRequestStatus.WAITING_INFORMATION);
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
    requestedItem: "Pastilhas de freio",
    extractedVehicleData: {
      brand: "Toyota",
      model: "Corolla",
      year: 2020,
      version: "XEi",
    },
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
    description: "Fornecer orçamento ao cliente",
  });
});

test("does not reuse a closed Opportunity or responded QuoteRequest", async () => {
  const harness = createHarness(makeInterpretation({
    requestedItem: "Troca de óleo",
    extractedVehicleData: {
      brand: "Toyota",
      model: "Corolla",
      year: 2020,
      version: "XEi",
    },
  }));
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
  assert.equal(opportunities[1]?.id, "opportunity-1");
  assert.equal(opportunities[1]?.status, OpportunityStatus.WAITING_BUSINESS);
  assert.equal(quoteRequests[0]?.id, "quote-existing");
  assert.equal(quoteRequests[0]?.status, QuoteRequestStatus.RESPONDED);
  assert.equal(quoteRequests[1]?.id, "quote-1");
  assert.equal(quoteRequests[1]?.status, QuoteRequestStatus.WAITING_BUSINESS);
});

test("APPOINTMENT_REQUEST creates an Appointment", async () => {
  const { harness } = await runAppointmentRequest();
  const appointment = (await harness.appointmentRepository.findById(
    "business-a",
    "appointment-1",
  )) as Appointment | null;

  assert.ok(appointment);
  assert.equal(appointment.businessId, "business-a");
  assert.equal(appointment.conversationId, "conversation-1");
});

test("requested Appointment remains REQUESTED without confirmation time", async () => {
  const { harness } = await runAppointmentRequest();
  const appointment = await harness.appointmentRepository.findById(
    "business-a",
    "appointment-1",
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
    "appointment-1",
  );

  assert.equal(appointment?.requestDescription, "Instalação de para-brisa");
});

test("uses original customer content when Appointment requestedItem is absent", async () => {
  const content = "Quero marcar uma avaliação dos pneus.";
  const { harness } = await runAppointmentRequest({}, content);
  const appointment = await harness.appointmentRepository.findById(
    "business-a",
    "appointment-1",
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
    "appointment-1",
  );
  const handoff = await harness.humanHandoffRepository.findById(
    "business-a",
    "handoff-1",
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

test("persists and incrementally merges vehicle data across quote turns", async () => {
  const harness = createHarness([
    makeInterpretation({ extractedVehicleData: { model: "Corolla", year: 2020 } }),
    makeInterpretation({ requestedItem: "Troca de óleo", extractedVehicleData: { brand: "Toyota", version: "XEi" } }),
    makeInterpretation({ requestedItem: "Troca de óleo", extractedVehicleData: { licensePlate: "ABC1D23", mileage: 42000 } }),
  ]);

  await processQuoteOnHarness(harness, "I have a Corolla 2020.");
  const firstConversation = await harness.conversationRepository.findById("business-a", "conversation-1");
  const vehicleId = firstConversation?.vehicleId;
  assert.equal(vehicleId, "vehicle-1");
  const [firstOpportunity] = await harness.opportunityRepository.listByConversation("business-a", "conversation-1");
  const [firstQuote] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");
  assert.equal(firstOpportunity?.status, OpportunityStatus.WAITING_CUSTOMER);
  assert.equal(firstQuote?.status, QuoteRequestStatus.WAITING_INFORMATION);

  await processQuoteOnHarness(harness, "É Toyota XEi. Quero troca de óleo.");
  const [secondOpportunity] = await harness.opportunityRepository.listByConversation("business-a", "conversation-1");
  const [secondQuote] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");
  const vehicleAfterSecondTurn = await harness.vehicleRepository.findById("business-a", vehicleId!);
  assert.equal(vehicleAfterSecondTurn?.model, "Corolla");
  assert.equal(vehicleAfterSecondTurn?.year, 2020);
  assert.equal(vehicleAfterSecondTurn?.brand, "Toyota");
  assert.equal(vehicleAfterSecondTurn?.version, "XEi");
  assert.equal(secondOpportunity?.id, firstOpportunity?.id);
  assert.equal(secondQuote?.id, firstQuote?.id);
  assert.equal(secondOpportunity?.status, OpportunityStatus.WAITING_BUSINESS);
  assert.equal(secondQuote?.status, QuoteRequestStatus.WAITING_BUSINESS);

  await processQuoteOnHarness(harness, "The plate is ABC1D23 and mileage is 42,000 km.");
  const finalConversation = await harness.conversationRepository.findById("business-a", "conversation-1");
  const finalVehicle = await harness.vehicleRepository.findById("business-a", vehicleId!);
  const [finalOpportunity] = await harness.opportunityRepository.listByConversation("business-a", "conversation-1");
  const [finalQuote] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");

  assert.equal(finalConversation?.vehicleId, vehicleId);
  assert.deepEqual({
    brand: finalVehicle?.brand,
    model: finalVehicle?.model,
    year: finalVehicle?.year,
    version: finalVehicle?.version,
    licensePlate: finalVehicle?.licensePlate,
    mileage: finalVehicle?.mileage,
  }, {
    brand: "Toyota",
    model: "Corolla",
    year: 2020,
    version: "XEi",
    licensePlate: "ABC1D23",
    mileage: 42000,
  });
  assert.equal(await harness.vehicleRepository.findById("business-a", "vehicle-2"), null);
  assert.equal(finalOpportunity?.id, firstOpportunity?.id);
  assert.equal(finalQuote?.id, firstQuote?.id);
  assert.equal(finalOpportunity?.vehicleId, vehicleId);
  assert.equal(finalQuote?.vehicleId, vehicleId);
  assert.equal(finalOpportunity?.status, OpportunityStatus.WAITING_BUSINESS);
  assert.equal(finalQuote?.status, QuoteRequestStatus.WAITING_BUSINESS);
});

test("does not create a Vehicle when extracted vehicle data is empty", async () => {
  const harness = createHarness(makeInterpretation({ extractedVehicleData: {} }));

  await processQuoteOnHarness(harness);

  const conversation = await harness.conversationRepository.findById("business-a", "conversation-1");
  assert.equal(conversation?.vehicleId, undefined);
  assert.equal(await harness.vehicleRepository.findById("business-a", "vehicle-1"), null);
});

test("persists Customer data progressively and links new quote entities", async () => {
  const harness = createHarness([
    makeInterpretation({
      extractedCustomerData: { name: "Carlos" },
      extractedVehicleData: { model: "Corolla", year: 2020 },
    }),
    makeInterpretation({
      extractedCustomerData: { primaryPhone: "11999999999" },
      extractedVehicleData: { brand: "Toyota", version: "XEi" },
    }),
    makeInterpretation({ extractedCustomerData: { email: "carlos@exemplo.com", name: "", primaryPhone: "   " } }),
  ]);

  await processQuoteOnHarness(harness, "Meu nome é Carlos. Tenho um Corolla 2020 e quero orçamento para pastilhas.");
  const firstConversation = await harness.conversationRepository.findById("business-a", "conversation-1");
  const customerId = firstConversation?.customerId;
  const vehicleId = firstConversation?.vehicleId;
  assert.equal(customerId, "customer-1");
  assert.equal(vehicleId, "vehicle-1");
  const [opportunity] = await harness.opportunityRepository.listByConversation("business-a", "conversation-1");
  const [quoteRequest] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");
  assert.equal(opportunity?.customerId, customerId);
  assert.equal(quoteRequest?.customerId, customerId);

  await processQuoteOnHarness(harness, "É Toyota XEi. Meu telefone é 11999999999.");
  await processQuoteOnHarness(harness, "Meu e-mail é carlos@exemplo.com.");

  const customer = await harness.customerRepository.findById("business-a", customerId!);
  const finalConversation = await harness.conversationRepository.findById("business-a", "conversation-1");
  assert.deepEqual({ name: customer?.name, primaryPhone: customer?.primaryPhone, email: customer?.email }, {
    name: "Carlos",
    primaryPhone: "11999999999",
    email: "carlos@exemplo.com",
  });
  assert.equal(finalConversation?.customerId, customerId);
  assert.equal(finalConversation?.vehicleId, vehicleId);
  const finalVehicle = await harness.vehicleRepository.findById("business-a", vehicleId!);
  assert.equal(finalVehicle?.brand, "Toyota");
  assert.equal(finalVehicle?.model, "Corolla");
  assert.equal(finalVehicle?.year, 2020);
  assert.equal(finalVehicle?.version, "XEi");
  const [finalOpportunity] = await harness.opportunityRepository.listByConversation("business-a", "conversation-1");
  const [finalQuoteRequest] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");
  assert.equal(finalOpportunity?.id, opportunity?.id);
  assert.equal(finalQuoteRequest?.id, quoteRequest?.id);
  assert.equal((await harness.opportunityRepository.listByConversation("business-a", "conversation-1")).length, 1);
  assert.equal((await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1")).length, 1);
  assert.equal(await harness.customerRepository.findById("business-a", "customer-2"), null);
});

test("does not create a Customer without useful extracted data", async () => {
  const harness = createHarness(makeInterpretation({
    extractedCustomerData: { name: "", primaryPhone: "   " },
  }));

  await processQuoteOnHarness(harness);

  const conversation = await harness.conversationRepository.findById("business-a", "conversation-1");
  assert.equal(conversation?.customerId, undefined);
  assert.equal(await harness.customerRepository.findById("business-a", "customer-1"), null);
});

test("associates a later Customer with the existing quote pair and Vehicle", async () => {
  const harness = createHarness([
    makeInterpretation({
      extractedVehicleData: { brand: "Toyota", model: "Corolla", year: 2020, version: "XEi" },
    }),
    makeInterpretation({ extractedCustomerData: { name: "Carlos" } }),
  ]);

  await processQuoteOnHarness(harness, "Quero orçamento para meu Corolla.");
  const firstConversation = await harness.conversationRepository.findById("business-a", "conversation-1");
  const [firstOpportunity] = await harness.opportunityRepository.listByConversation("business-a", "conversation-1");
  const [firstQuote] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");

  await processQuoteOnHarness(harness, "Meu nome é Carlos.");

  const conversation = await harness.conversationRepository.findById("business-a", "conversation-1");
  const [opportunity] = await harness.opportunityRepository.listByConversation("business-a", "conversation-1");
  const [quoteRequest] = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");
  const vehicle = await harness.vehicleRepository.findById("business-a", firstConversation!.vehicleId!);

  assert.equal(opportunity?.id, firstOpportunity?.id);
  assert.equal(quoteRequest?.id, firstQuote?.id);
  assert.equal(opportunity?.customerId, conversation?.customerId);
  assert.equal(quoteRequest?.customerId, conversation?.customerId);
  assert.equal(vehicle?.customerId, conversation?.customerId);
  assert.equal(conversation?.vehicleId, firstConversation?.vehicleId);
  assert.equal((await harness.opportunityRepository.listByConversation("business-a", "conversation-1")).length, 1);
  assert.equal((await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1")).length, 1);
});

test("links a newly created Vehicle to an existing Customer", async () => {
  const harness = createHarness(
    makeInterpretation({
      extractedCustomerData: { primaryPhone: "11999999999" },
      extractedVehicleData: { model: "Corolla", year: 2020 },
    }),
    makeConversation({ customerId: "customer-existing" }),
  );
  const existingCustomer: Customer = {
    id: "customer-existing",
    businessId: "business-a",
    name: "Carlos",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await harness.customerRepository.save(existingCustomer);

  await processQuoteOnHarness(harness);

  const conversation = await harness.conversationRepository.findById("business-a", "conversation-1");
  const vehicle = await harness.vehicleRepository.findById("business-a", conversation!.vehicleId!);
  const customer = await harness.customerRepository.findById("business-a", "customer-existing");
  assert.equal(conversation?.customerId, "customer-existing");
  assert.equal(conversation?.vehicleId, "vehicle-1");
  assert.equal(vehicle?.customerId, "customer-existing");
  assert.equal(vehicle?.model, "Corolla");
  assert.equal(customer?.name, "Carlos");
  assert.equal(customer?.primaryPhone, "11999999999");
});

const failingInterpreter: MessageInterpreter = { interpret: async () => { throw new Error("synthetic LLM outage"); } };

test("LLM failure preserves the message, sends fixed text and opens the AI_FAILURE handoff once; the next message gets no answer", async () => {
  const harness = createHarness();
  const saved: HumanHandoff[] = [];
  const saveHandoff = harness.humanHandoffRepository.save.bind(harness.humanHandoffRepository);
  harness.humanHandoffRepository.save = async (entity) => { saved.push(entity); await saveHandoff(entity); };
  const dependencies = { ...harness.dependencies, interpreter: failingInterpreter };
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Mensagem preservada" };

  const first = await processMessage(input, dependencies);
  await processMessage(input, dependencies);

  assert.equal(first.reply, LLM_FAILURE_REPLY);
  assert.equal(first.requiresHuman, true);
  assert.equal(first.conversationStatus, ConversationStatus.WAITING_HUMAN);
  assert.deepEqual(saved.map(({ reason }) => reason), [HandoffReason.AI_FAILURE]);
  const messages = await harness.messageRepository.listByConversation("business-a", "conversation-1");
  assert.deepEqual(messages.map(({ senderType }) => senderType), [SenderType.CUSTOMER, SenderType.ASSISTANT, SenderType.CUSTOMER]);
  assert.equal(messages[0]!.content, "Mensagem preservada");
  assert.equal((await harness.conversationRepository.findById("business-a", "conversation-1"))?.commercialOutcome, CommercialOutcome.HUMAN_HANDOFF);
});

test("a blocked LlmGuard answers with fixed text and never calls the LLM", async () => {
  const harness = createHarness();
  const llmGuard = new LlmGuard({ now: () => timestamp, dailyCallsPerBusiness: 1, countCallsSince: async () => 1 });

  const result = await processMessage(
    { businessId: "business-a", conversationId: "conversation-1", content: "Oi" },
    { ...harness.dependencies, llmGuard },
  );

  assert.equal(result.reply, LLM_LIMITED_REPLY);
  assert.equal(result.requiresHuman, false);
  assert.equal(result.conversationStatus, ConversationStatus.ACTIVE);
  assert.equal(harness.interpreterInputs.length, 0);
  assert.equal((await harness.messageRepository.listByConversation("business-a", "conversation-1")).length, 2);
});

test("an unsupported message gets the fixed text without interpretation", async () => {
  const harness = createHarness();
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "[mensagem sem texto]" };

  await receiveCustomerMessage(input, harness.dependencies);
  const result = await applyInterpretation(input, { status: "UNSUPPORTED" }, harness.dependencies);

  assert.equal(result.reply, UNSUPPORTED_MESSAGE_REPLY);
  assert.equal(harness.interpreterInputs.length, 0);
});

test("receiving the same external message twice stores it once", async () => {
  const harness = createHarness();
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Uma vez", externalMessageId: "external-1" };

  await receiveCustomerMessage(input, harness.dependencies);
  const retried = await receiveCustomerMessage(input, harness.dependencies);

  assert.equal(retried.history.length, 1);
  assert.equal(retried.history[0]!.externalMessageId, "external-1");
  assert.equal((await harness.messageRepository.listByConversation("business-a", "conversation-1")).length, 1);
});

test("applyInterpretation reads the conversation again instead of trusting reception state", async () => {
  const harness = createHarness(makeInterpretation({ intent: Intent.GENERAL_INFORMATION }));
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Oi" };
  const received = await receiveCustomerMessage(input, harness.dependencies);
  const outcome = await interpretCustomerMessage(received, "sender-a", harness.dependencies);
  const conversation = (await harness.conversationRepository.findById("business-a", "conversation-1"))!;
  await harness.conversationRepository.save({ ...conversation, customerId: "customer-from-concurrent-message" });

  await applyInterpretation(input, outcome, harness.dependencies);

  assert.equal((await harness.conversationRepository.findById("business-a", "conversation-1"))?.customerId, "customer-from-concurrent-message");
});

test("a price authorized between the read and the write survives and the customer is told the order is locked", async () => {
  const harness = createHarness(makeInterpretation({ requestedItem: "Outro pedido" }));
  const { quoteRequest, opportunity } = await seedQuotePair(harness, OpportunityStatus.WAITING_BUSINESS, QuoteRequestStatus.WAITING_BUSINESS);
  const updateIntake = harness.quoteRequestRepository.updateIntake.bind(harness.quoteRequestRepository);
  harness.quoteRequestRepository.updateIntake = async (entity) => {
    await harness.quoteRequestRepository.save({ ...quoteRequest, status: QuoteRequestStatus.RESPONDED, authorizedPrice: { amountCents: 28200, currency: "BRL" } });
    return updateIntake(entity);
  };

  const result = await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "Mudei de ideia" }, harness.dependencies);

  const after = await harness.quoteRequestRepository.findById("business-a", quoteRequest.id);
  assert.equal(after?.authorizedPrice?.amountCents, 28200);
  assert.equal(after?.status, QuoteRequestStatus.RESPONDED);
  assert.equal(after?.requestDescription, quoteRequest.requestDescription);
  assert.deepEqual(await harness.opportunityRepository.findById("business-a", opportunity.id), opportunity);
  assert.equal(result.reply, QUOTE_LOCKED_REPLY);
  assert.equal(result.handoffOpened, true);
  assert.equal(result.requiresHuman, true);
  assert.equal(result.conversationStatus, ConversationStatus.WAITING_HUMAN);
});

const seedRespondedQuote = async (harness: ReturnType<typeof createHarness>) => {
  const seeded = await seedQuotePair(harness, OpportunityStatus.WAITING_CUSTOMER, QuoteRequestStatus.RESPONDED);
  await harness.quoteRequestRepository.save({ ...seeded.quoteRequest, authorizedPrice: { amountCents: 28200, currency: "BRL" } });
  return seeded;
};

test("asking again for the responded item creates no new order, whatever the accents or case", async () => {
  for (const requestedItem of ["Pastilhas de freio", "PASTILHAS  DE FREIO", "pastílhas de fréio"]) {
    const harness = createHarness(makeInterpretation({ requestedItem }));
    await seedRespondedQuote(harness);

    const result = await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "Quero orçar de novo" }, harness.dependencies);

    assert.equal(result.reply, QUOTE_LOCKED_REPLY);
    assert.equal(result.handoffOpened, true);
    assert.equal((await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1")).length, 1, requestedItem);
    assert.equal((await harness.opportunityRepository.listByConversation("business-a", "conversation-1")).length, 1);
  }
});

test("a different item next to a responded quote creates a new order", async () => {
  const harness = createHarness(makeInterpretation({ requestedItem: "Troca de óleo" }));
  await seedRespondedQuote(harness);

  const result = await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "Quero também o óleo" }, harness.dependencies);

  const quotes = await harness.quoteRequestRepository.listByConversation("business-a", "conversation-1");
  assert.deepEqual(quotes.map(({ requestDescription }) => requestDescription), ["Pastilhas de freio", "Troca de óleo"]);
  assert.notEqual(result.reply, QUOTE_LOCKED_REPLY);
});

const seedDeliveredQuote = async (harness: ReturnType<typeof createHarness>, status = OutboundDeliveryStatus.DELIVERED) => {
  const { quoteRequest } = await seedRespondedQuote(harness);
  const outboundDeliveryRepository = new InMemoryOutboundDeliveryRepository();
  await outboundDeliveryRepository.create({
    id: "delivery-1", businessId: "business-a", quoteRequestId: quoteRequest.id, conversationId: "conversation-1", channel: Channel.WEB,
    status, attempts: 1, createdAt: timestamp, updatedAt: timestamp,
  });
  return { ...harness.dependencies, outboundDeliveryRepository };
};

test("any answer to a delivered price opens a handoff, whatever the model understood", async () => {
  for (const intent of [Intent.GENERAL_INFORMATION, Intent.OTHER, Intent.UNKNOWN, Intent.QUOTE_REQUEST]) {
    const harness = createHarness(makeInterpretation({ intent, proposedResponse: "Certo!" }));
    const dependencies = await seedDeliveredQuote(harness);

    const result = await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "Tá bom então" }, dependencies);

    assert.equal(result.reply, HANDOFF_REPLY, intent);
    assert.equal(result.handoffOpened, true);
    assert.equal(result.conversationStatus, ConversationStatus.WAITING_HUMAN);
  }
});

test("an audio or a limited sender answering a delivered price reaches a person too", async () => {
  for (const status of ["UNSUPPORTED", "LIMITED"] as const) {
    const harness = createHarness();
    const dependencies = await seedDeliveredQuote(harness);

    const result = await applyInterpretation({ businessId: "business-a", conversationId: "conversation-1", content: "[mensagem sem texto]" }, { status }, dependencies);

    assert.equal(result.reply, HANDOFF_REPLY, status);
    assert.equal(result.handoffOpened, true);
    assert.equal(result.requiresHuman, true);
    assert.equal(result.conversationStatus, ConversationStatus.WAITING_HUMAN);
  }
});


test("no handoff for a price not delivered yet, nor once an appointment is active", async () => {
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Oi" };
  const interpretation = makeInterpretation({ intent: Intent.GENERAL_INFORMATION, proposedResponse: "Certo!" });

  const notDelivered = createHarness(interpretation);
  const pending = await processMessage(input, await seedDeliveredQuote(notDelivered, OutboundDeliveryStatus.FAILED_RETRYABLE));
  assert.equal(pending.reply, "Certo!");

  const scheduled = createHarness(interpretation);
  const dependencies = await seedDeliveredQuote(scheduled);
  await scheduled.appointmentRepository.save({ id: "appointment-1", businessId: "business-a", conversationId: "conversation-1", status: AppointmentStatus.CONFIRMED, createdAt: timestamp, updatedAt: timestamp });
  assert.equal((await processMessage(input, dependencies)).reply, "Certo!");
});

const giveBackToBot = async (harness: ReturnType<typeof createHarness>) => {
  for (const handoff of await harness.humanHandoffRepository.listOpen("business-a")) {
    await harness.humanHandoffRepository.save({ ...handoff, status: HandoffStatus.RESOLVED, resolvedAt: timestamp, updatedAt: timestamp });
  }
  const conversation = (await harness.conversationRepository.findById("business-a", "conversation-1"))!;
  await harness.conversationRepository.save({ ...conversation, status: ConversationStatus.ACTIVE });
};

test("a delivered price opens one handoff: given back to the bot, the next messages are answered with no new handoff", async () => {
  const harness = createHarness(makeInterpretation({ intent: Intent.GENERAL_INFORMATION, proposedResponse: "Certo!" }));
  const dependencies = await seedDeliveredQuote(harness);
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Tá bom então" };

  assert.equal((await processMessage(input, dependencies)).handoffOpened, true);
  await giveBackToBot(harness);

  const answered = await processMessage(input, dependencies);
  assert.equal(answered.reply, "Certo!");
  assert.equal(answered.handoffOpened, undefined);
  assert.equal(answered.conversationStatus, ConversationStatus.ACTIVE);

  const audio = await applyInterpretation({ ...input, content: "[mensagem sem texto]" }, { status: "UNSUPPORTED" }, dependencies);
  assert.equal(audio.reply, UNSUPPORTED_MESSAGE_REPLY);
  assert.equal(audio.handoffOpened, undefined);
  assert.deepEqual(await harness.humanHandoffRepository.listOpen("business-a"), []);
  assert.equal((await harness.humanHandoffRepository.listByConversation("business-a", "conversation-1")).length, 1);
});

test("asking again for a quote already handed off gets the locked text, without another handoff", async () => {
  const harness = createHarness([
    makeInterpretation({ intent: Intent.GENERAL_INFORMATION }),
    makeInterpretation({ requestedItem: "Pastilhas de freio" }),
  ]);
  const dependencies = await seedDeliveredQuote(harness);
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Oi" };

  await processMessage(input, dependencies);
  await giveBackToBot(harness);
  const again = await processMessage(input, dependencies);

  assert.equal(again.reply, QUOTE_LOCKED_REPLY);
  assert.equal(again.handoffOpened, undefined);
  assert.equal(again.conversationStatus, ConversationStatus.ACTIVE);
});

test("accepting a delivered quote records the appointment and reaches a person", async () => {
  const harness = createHarness(makeInterpretation({ intent: Intent.APPOINTMENT_REQUEST, requestedItem: "Troca de óleo" }));
  const dependencies = await seedDeliveredQuote(harness);

  const result = await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "sim, pode fazer" }, dependencies);

  assert.equal(result.handoffOpened, true);
  assert.equal(result.reply, HANDOFF_REPLY);
  assert.equal((await harness.appointmentRepository.listByConversation("business-a", "conversation-1")).length, 1);
});

test("only a handoff created after the last update of the quote counts, and a second delivered quote gets its own", async () => {
  const harness = createHarness(makeInterpretation({ intent: Intent.GENERAL_INFORMATION, proposedResponse: "Certo!" }));
  const dependencies = await seedDeliveredQuote(harness);
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Oi" };
  const old = "2025-12-30T12:00:00.000Z"; // before the seeded quote's update
  await harness.humanHandoffRepository.save({ id: "handoff-old", businessId: "business-a", conversationId: "conversation-1", reason: HandoffReason.OTHER, summary: "", status: HandoffStatus.RESOLVED, requestedAt: old, createdAt: old, updatedAt: old });

  assert.equal((await processMessage(input, dependencies)).handoffOpened, true);
  await giveBackToBot(harness);

  const seeded = (await harness.quoteRequestRepository.findById("business-a", "quote-existing"))!;
  await harness.quoteRequestRepository.save({ ...seeded, id: "quote-second", updatedAt: "2026-01-01T13:00:00.000Z" });
  await dependencies.outboundDeliveryRepository.create({
    id: "delivery-2", businessId: "business-a", quoteRequestId: "quote-second", conversationId: "conversation-1", channel: Channel.WEB,
    status: OutboundDeliveryStatus.DELIVERED, attempts: 1, createdAt: timestamp, updatedAt: timestamp,
  });
  assert.equal((await processMessage(input, { ...dependencies, now: () => "2026-01-01T13:30:00.000Z" })).handoffOpened, true);
});

for (const [intent, reason] of [
  [Intent.APPOINTMENT_CHANGE, HandoffReason.OTHER],
  [Intent.APPOINTMENT_CANCEL, HandoffReason.OTHER],
  [Intent.VEHICLE_STATUS, HandoffReason.OTHER],
  [Intent.WARRANTY, HandoffReason.WARRANTY_OR_COMPLAINT],
  [Intent.COMPLAINT, HandoffReason.WARRANTY_OR_COMPLAINT],
] as const) {
  test(`${intent} always goes to a person with the fixed text, even if the model did not ask`, async () => {
    const harness = createHarness(makeInterpretation({ intent, requiresHuman: false, proposedResponse: "Já resolvi por aqui." }));

    const result = await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "Oi" }, harness.dependencies);

    assert.equal(result.reply, HANDOFF_REPLY);
    assert.equal(result.handoffOpened, true);
    assert.deepEqual((await harness.humanHandoffRepository.listOpen("business-a")).map((handoff) => handoff.reason), [reason]);
  });
}

test("vehicle data does not change while a priced quote or a live draft exists", async () => {
  const vehicle = { id: "vehicle-1", businessId: "business-a", brand: "Toyota", model: "Corolla", createdAt: timestamp, updatedAt: timestamp };
  const interpretation = makeInterpretation({ intent: Intent.GENERAL_INFORMATION, extractedVehicleData: { model: "Civic", year: 2010 } });
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Na verdade é um Civic" };

  const priced = createHarness(interpretation, makeConversation({ vehicleId: vehicle.id }));
  await priced.vehicleRepository.save(vehicle);
  await seedRespondedQuote(priced);
  await processMessage(input, priced.dependencies);
  assert.deepEqual(await priced.vehicleRepository.findById("business-a", vehicle.id), vehicle);

  for (const [status, changed] of [[QuoteDraftStatus.PENDING_APPROVAL, false], [QuoteDraftStatus.APPROVED, false], [QuoteDraftStatus.SUPERSEDED, true]] as const) {
    const drafted = createHarness(interpretation, makeConversation({ vehicleId: vehicle.id }));
    await drafted.vehicleRepository.save(vehicle);
    await seedQuotePair(drafted, OpportunityStatus.WAITING_BUSINESS, QuoteRequestStatus.WAITING_BUSINESS);
    await processMessage(input, {
      ...drafted.dependencies,
      quoteDraftRepository: { findLatestByQuoteRequest: async () => ({ status }) as QuoteDraft },
    });
    assert.equal((await drafted.vehicleRepository.findById("business-a", vehicle.id))?.model === "Civic", changed, status);
  }
});

test("redaction markers never become customer or vehicle data", async () => {
  const harness = createHarness(makeInterpretation({
    intent: Intent.GENERAL_INFORMATION,
    extractedCustomerData: { name: "[EMAIL]", primaryPhone: "[TELEFONE]", email: "[EMAIL]" },
    extractedVehicleData: { licensePlate: "[CPF]", version: "[TELEFONE]" },
  }));

  await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "Oi" }, harness.dependencies);

  const conversation = await harness.conversationRepository.findById("business-a", "conversation-1");
  assert.equal(conversation?.customerId, undefined);
  assert.equal(conversation?.vehicleId, undefined);
});

test("a reply blocked by the output filter hands off once, so the promise of a return is true", async () => {
  const harness = createHarness(makeInterpretation({ intent: Intent.GENERAL_INFORMATION, proposedResponse: "A troca sai por R$ 1." }));
  const saved: HumanHandoff[] = [];
  const saveHandoff = harness.humanHandoffRepository.save.bind(harness.humanHandoffRepository);
  harness.humanHandoffRepository.save = async (entity) => { saved.push(entity); await saveHandoff(entity); };
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Quanto fica?" };

  const result = await processMessage(input, harness.dependencies);
  await processMessage(input, harness.dependencies);

  assert.equal(result.reply, UNSAFE_REPLY_FALLBACK);
  assert.equal(result.requiresHuman, true);
  assert.equal(result.conversationStatus, ConversationStatus.WAITING_HUMAN);
  assert.deepEqual(saved.map(({ reason }) => reason), [HandoffReason.UNKNOWN_INFORMATION]);
});

test("limit and unsupported texts go out at most once per sender in 10 minutes", async () => {
  let now = timestamp;
  const harness = createHarness();
  const dependencies = { ...harness.dependencies, now: () => now };
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "[mensagem sem texto]" };
  const assistantReplies = async () => (await harness.messageRepository.listByConversation("business-a", "conversation-1"))
    .filter(({ senderType }) => senderType === SenderType.ASSISTANT).length;

  assert.equal((await applyInterpretation(input, { status: "UNSUPPORTED" }, dependencies)).silenced, undefined);
  assert.equal((await applyInterpretation(input, { status: "UNSUPPORTED" }, dependencies)).silenced, true);
  assert.equal((await applyInterpretation(input, { status: "LIMITED" }, dependencies)).silenced, true);
  assert.equal(await assistantReplies(), 1);

  now = "2026-01-01T12:10:00.000Z";
  assert.equal((await applyInterpretation(input, { status: "LIMITED" }, dependencies)).silenced, undefined);
  assert.equal(await assistantReplies(), 2);
});

test("the limit text does not promise a return", () => {
  assert.equal(/equipe|retorn|contato/i.test(LLM_LIMITED_REPLY), false);
});

const workshopProfile = (overrides: Partial<BusinessProfile> = {}): BusinessProfile => ({
  businessId: "business-a",
  address: "Rua das Oficinas, 10",
  openingHours: { 1: [{ open: "08:00", close: "18:00" }], 2: [{ open: "08:00", close: "18:00" }], 6: [{ open: "08:00", close: "12:00" }] },
  services: ["Troca de óleo"],
  paymentMethods: ["Pix"],
  updatedAt: timestamp,
  ...overrides,
});

const withProfile = async (harness: ReturnType<typeof createHarness>, profile: BusinessProfile, now: () => string = () => timestamp) => {
  const businessProfileRepository = new InMemoryBusinessProfileRepository();
  await businessProfileRepository.save(profile);
  return {
    ...harness.dependencies,
    businessProfileRepository,
    businessRepository: { findById: async () => ({ timezone: "America/Manaus" }) as never },
    now,
  };
};

test("a conversation with a person keeps the message but is not interpreted, counted or answered", async () => {
  const harness = createHarness(makeInterpretation(), makeConversation({ status: ConversationStatus.WAITING_HUMAN }));
  let guardCalls = 0;
  const llmGuard = new LlmGuard({ now: () => timestamp, countCallsSince: async () => { guardCalls += 1; return 0; } });
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Alguém aí?" };

  const result = await processMessage(input, { ...harness.dependencies, llmGuard });

  assert.equal(result.silenced, true);
  assert.equal(result.reply, "");
  assert.equal(result.conversationStatus, ConversationStatus.WAITING_HUMAN);
  assert.equal(harness.interpreterInputs.length, 0);
  assert.equal(guardCalls, 0);
  assert.deepEqual((await harness.messageRepository.listByConversation("business-a", "conversation-1")).map(({ senderType }) => senderType), [SenderType.CUSTOMER]);
});

test("a message into a conversation a person took asks for the notice; one nobody took yet does not", async () => {
  const harness = createHarness(makeInterpretation(), makeConversation({ status: ConversationStatus.WAITING_HUMAN }));
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Alguém aí?" };
  const handoff: HumanHandoff = { id: "handoff-1", businessId: "business-a", conversationId: "conversation-1", reason: HandoffReason.CUSTOMER_REQUEST, summary: "", status: HandoffStatus.REQUESTED, requestedAt: timestamp, createdAt: timestamp, updatedAt: timestamp };

  await harness.humanHandoffRepository.save(handoff);
  assert.equal((await processMessage(input, harness.dependencies)).customerWroteToPerson, undefined);

  await harness.humanHandoffRepository.save({ ...handoff, status: HandoffStatus.ACCEPTED, acceptedAt: timestamp });
  const taken = await processMessage(input, harness.dependencies);
  assert.equal(taken.customerWroteToPerson, true);
  assert.equal(taken.silenced, true);
});

test("a conversation has one open handoff however many times the customer asks", async () => {
  const harness = createHarness(makeInterpretation({ intent: Intent.HUMAN_REQUEST }));
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Quero uma pessoa" };

  const first = await processMessage(input, harness.dependencies);
  // The person returns the conversation to the bot while a second request is already being interpreted.
  const conversation = (await harness.conversationRepository.findById("business-a", "conversation-1"))!;
  await harness.conversationRepository.save({ ...conversation, status: ConversationStatus.ACTIVE });
  const second = await processMessage(input, harness.dependencies);

  assert.equal(first.handoffOpened, true);
  assert.equal(second.handoffOpened, undefined);
  assert.equal((await harness.humanHandoffRepository.listOpen("business-a")).length, 1);
});

test("the handoff summary is the last five customer messages, capped at 500 characters", async () => {
  const harness = createHarness(makeInterpretation({ intent: Intent.HUMAN_REQUEST }));
  for (let index = 1; index <= 7; index += 1) {
    await harness.messageRepository.save({
      id: `seed-${index}`, businessId: "business-a", conversationId: "conversation-1",
      senderType: index === 4 ? SenderType.ASSISTANT : SenderType.CUSTOMER, channel: Channel.WEB, content: `mensagem ${index}`,
      createdAt: `2026-01-01T11:0${index}:00.000Z`,
    });
  }

  await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "mensagem 8" }, harness.dependencies);

  const [handoff] = await harness.humanHandoffRepository.listOpen("business-a");
  assert.equal(handoff?.summary, ["mensagem 3", "mensagem 5", "mensagem 6", "mensagem 7", "mensagem 8"].join("\n"));

  const long = createHarness(makeInterpretation({ intent: Intent.HUMAN_REQUEST }));
  await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: `${"a".repeat(600)}fim` }, long.dependencies);
  const [capped] = await long.humanHandoffRepository.listOpen("business-a");
  assert.equal(capped?.summary.length, 500);
  assert.equal(capped?.summary.endsWith("aafim"), true);
});

test("the registered facts and the local time reach the interpreter as data, without the private notice number", async () => {
  const harness = createHarness(makeInterpretation({ intent: Intent.GENERAL_INFORMATION }));
  const dependencies = await withProfile(harness, workshopProfile({ notifyPhone: "5592999991234" }), () => "2026-11-07T15:00:00.000Z");

  await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "Abrem sábado?" }, dependencies);

  const [received] = harness.interpreterInputs;
  assert.equal(received?.businessFacts?.openingHours?.sábado, "08:00-12:00");
  assert.equal(received?.businessFacts?.address, "Rua das Oficinas, 10");
  assert.equal(received?.localDateTime, "2026-11-07 11:00 (sábado, America/Manaus)");
  assert.equal(JSON.stringify(received).includes("5592999991234"), false);

  const bare = createHarness(makeInterpretation({ intent: Intent.GENERAL_INFORMATION }));
  await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "Oi" }, bare.dependencies);
  assert.equal(Object.hasOwn(bare.interpreterInputs[0]!, "businessFacts"), false);
  assert.equal(Object.hasOwn(bare.interpreterInputs[0]!, "localDateTime"), false);
});

test("outside the hours every automatic answer tells when the workshop opens, once every 12 hours", async () => {
  let now = "2026-11-07T17:00:00.000Z"; // Saturday 13:00 in Manaus, closed
  const harness = createHarness(makeInterpretation({ intent: Intent.GENERAL_INFORMATION, proposedResponse: "Fazemos troca de óleo." }));
  const dependencies = await withProfile(harness, workshopProfile(), () => now);
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Oi" };
  const notice = "Estamos fora do horário de atendimento. Voltamos na segunda-feira às 08:00.";

  assert.equal((await processMessage(input, dependencies)).reply, `Fazemos troca de óleo.\n${notice}`);
  now = "2026-11-07T18:00:00.000Z";
  assert.equal((await processMessage(input, dependencies)).reply, "Fazemos troca de óleo.");
  now = "2026-11-08T05:00:01.000Z"; // Sunday 01:00, more than 12 hours after the first notice
  assert.equal((await processMessage(input, dependencies)).reply, "Fazemos troca de óleo.\nEstamos fora do horário de atendimento. Voltamos amanhã às 08:00.");
  now = "2026-11-09T12:00:00.000Z"; // Monday 08:00: open
  assert.equal((await processMessage(input, dependencies)).reply, "Fazemos troca de óleo.");
});

test("fixed answers carry the opening notice too, and the 10 minute silence still recognizes them", async () => {
  const now = "2026-11-07T17:00:00.000Z";
  const harness = createHarness();
  const dependencies = { ...(await withProfile(harness, workshopProfile(), () => now)), llmGuard: new LlmGuard({ now: () => now, dailyCallsPerBusiness: 1, countCallsSince: async () => 1 }) };
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Oi" };

  const first = await processMessage(input, dependencies);
  const second = await processMessage(input, dependencies);

  assert.equal(first.reply.startsWith(LLM_LIMITED_REPLY), true);
  assert.equal(first.reply.includes("Voltamos na segunda-feira às 08:00."), true);
  assert.equal(second.silenced, true);
});

test("a number the workshop registered passes the output filter; the same reply without the profile does not", async () => {
  const proposedResponse = "Estamos na Rua das Oficinas, 10.";
  const harness = createHarness(makeInterpretation({ intent: Intent.GENERAL_INFORMATION, proposedResponse }));
  const dependencies = await withProfile(harness, workshopProfile(), () => "2026-11-09T15:00:00.000Z");
  const input = { businessId: "business-a", conversationId: "conversation-1", content: "Onde fica?" };

  assert.equal((await processMessage(input, dependencies)).reply, proposedResponse);

  const bare = createHarness(makeInterpretation({ intent: Intent.GENERAL_INFORMATION, proposedResponse }));
  assert.equal((await processMessage(input, bare.dependencies)).reply, UNSAFE_REPLY_FALLBACK);
});

test("a profile without hours changes nothing in the answers", async () => {
  const harness = createHarness(makeInterpretation({ intent: Intent.GENERAL_INFORMATION, proposedResponse: "Fazemos troca de óleo." }));
  const dependencies = await withProfile(harness, workshopProfile({ openingHours: {} }), () => "2026-11-07T17:00:00.000Z");

  const result = await processMessage({ businessId: "business-a", conversationId: "conversation-1", content: "Oi" }, dependencies);

  assert.equal(result.reply, "Fazemos troca de óleo.");
});
