import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { Intent, SenderType, Channel } from "../../src/core/domain/enums.js";
import type { Message } from "../../src/core/domain/entities.js";
import { INTERPRETER_INSTRUCTIONS, OpenAIMessageInterpreter } from "../../src/integrations/openai-message-interpreter.js";

const validModelOutput = () => ({
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: {
    name: null,
    primaryPhone: null,
    email: null,
  },
  extractedVehicleData: {
    brand: null,
    model: null,
    year: null,
    version: null,
    licensePlate: null,
    mileage: null,
  },
  symptomDescription: null,
  requestedItem: "Pastilhas de freio",
  missingData: [],
  suggestedNextAction: {
    type: "PROVIDE_QUOTE",
    description: "Registrar pedido de orçamento",
    dueAt: null,
    assignedTo: null,
  },
  requiresHuman: false,
  handoffReason: null,
  proposedResponse: "Vou registrar sua solicitação.",
  confidence: 0.9,
});

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: "message-internal-id",
  businessId: "business-internal-id",
  conversationId: "conversation-internal-id",
  senderType: SenderType.CUSTOMER,
  channel: Channel.WHATSAPP,
  content: "Meu carro precisa de pastilhas.",
  externalMessageId: "external-message-id",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const makeInterpreter = (outputParsed: unknown) => {
  const requests: unknown[] = [];
  const client = {
    responses: {
      async parse(request: unknown) {
        requests.push(request);
        return { output_parsed: outputParsed };
      },
    },
  } as unknown as OpenAI;

  return {
    interpreter: new OpenAIMessageInterpreter(client, "configured-test-model"),
    requests,
  };
};

const makeInput = () => ({
  businessId: "business-1",
  conversationId: "conversation-1",
  content: "Quero orçamento para pastilhas.",
  history: [makeMessage()],
});

type CapturedRequest = {
  model: string;
  instructions: string;
  input: string;
  store: boolean;
  text: {
    format: {
      name: string;
      type: string;
      schema: Record<string, unknown>;
    };
  };
};

const capturedRequest = (requests: unknown[]): CapturedRequest =>
  requests[0] as CapturedRequest;

test("returns AIInterpretation for valid output_parsed", async () => {
  const { interpreter } = makeInterpreter(validModelOutput());

  const result = await interpreter.interpret(makeInput());

  assert.equal(result.intent, Intent.QUOTE_REQUEST);
  assert.equal(result.requestedItem, "Pastilhas de freio");
  assert.equal(result.confidence, 0.9);
});

test("maps nullable model fields to absent internal properties", async () => {
  const { interpreter } = makeInterpreter(validModelOutput());

  const result = await interpreter.interpret(makeInput());

  assert.equal(Object.hasOwn(result.extractedCustomerData, "name"), false);
  assert.equal(Object.hasOwn(result.extractedVehicleData, "model"), false);
  assert.equal(Object.hasOwn(result, "symptomDescription"), false);
  assert.equal(Object.hasOwn(result.suggestedNextAction, "dueAt"), false);
  assert.equal(Object.hasOwn(result, "handoffReason"), false);
});

test("uses Responses API with the configured model and disables response storage", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());

  await interpreter.interpret(makeInput());

  assert.equal(requests.length, 1);
  assert.equal(capturedRequest(requests).model, "configured-test-model");
  assert.equal(capturedRequest(requests).store, false);
});

test("records provider usage with the business and conversation from the interpreter input", async () => {
  const requests: unknown[] = [];
  const usageEvents: Array<{ businessId: string; conversationId?: string; usage: Record<string, unknown> }> = [];
  const client = {
    responses: {
      async parse(request: unknown) {
        requests.push(request);
        return {
          id: "response-1",
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 25 },
            output_tokens: 40,
            total_tokens: 140,
          },
          output_parsed: validModelOutput(),
        };
      },
    },
  } as unknown as OpenAI;
  const interpreter = new OpenAIMessageInterpreter(client, "configured-test-model", {
    provider: "groq",
    usageRecorder: {
      async record(input) { usageEvents.push(input as typeof usageEvents[number]); },
    },
  });

  await interpreter.interpret(makeInput());

  assert.equal(requests.length, 1);
  assert.equal(usageEvents[0]?.businessId, "business-1");
  assert.equal(usageEvents[0]?.conversationId, "conversation-1");
  assert.equal((usageEvents[0]?.usage as { provider?: string }).provider, "groq");
  assert.equal((usageEvents[0]?.usage as { model?: string }).model, "configured-test-model");
  assert.equal((usageEvents[0]?.usage as { providerRequestId?: string }).providerRequestId, "response-1");
  assert.equal((usageEvents[0]?.usage as { inputTokens?: number }).inputTokens, 100);
  assert.equal((usageEvents[0]?.usage as { cachedInputTokens?: number }).cachedInputTokens, 25);
  assert.equal((usageEvents[0]?.usage as { outputTokens?: number }).outputTokens, 40);
});

test("sends current content and only reduced conversation history", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());
  const input = makeInput();

  await interpreter.interpret(input);

  const request = capturedRequest(requests);
  const context = JSON.parse(request.input) as Record<string, unknown>;
  assert.deepEqual(Object.keys(context).sort(), ["content", "history"]);
  assert.equal((request as unknown as { max_output_tokens: number }).max_output_tokens, 1200);
  assert.equal(context.content, "Quero orçamento para pastilhas.");
  assert.deepEqual(context.history, [
    {
      senderType: SenderType.CUSTOMER,
      content: "Meu carro precisa de pastilhas.",
    },
  ]);
  for (const excluded of [
    "message-internal-id",
    "business-internal-id",
    "conversation-internal-id",
    "external-message-id",
    "2026-01-01T00:00:00.000Z",
    '"channel"',
    "WHATSAPP",
  ]) {
    assert.equal(request.input.includes(excluded), false);
  }
});

test("uses Structured Output with the existing Zod schema", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());

  await interpreter.interpret(makeInput());

  const format = capturedRequest(requests).text.format;
  assert.equal(format.name, "automotive_interpretation");
  assert.equal(format.type, "json_schema");
  assert.ok(format.schema.properties);
  assert.equal(format.schema.additionalProperties, false);
});

test("instructions define extraction, missing-data handling and safety rules", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());

  await interpreter.interpret(makeInput());

  const instructions = capturedRequest(requests).instructions;
  assert.match(instructions, /explicitamente declarados/i);
  assert.match(instructions, /Não infira .* usando conhecimento geral/i);
  assert.match(instructions, /REQUEST_INFORMATION/i);
  assert.match(instructions, /UNKNOWN_INFORMATION/i);
  assert.match(instructions, /Nunca invente preço/i);
  assert.match(instructions, /Não confirme diagnósticos ou agendamentos/i);
  assert.match(instructions, /MINIMIZAÇÃO DE DADOS/);
  assert.match(instructions, /Nunca solicite dados apenas para completar cadastro/);
  assert.match(instructions, /Não invente requisitos da oficina/);
  assert.match(instructions, /WhatsApp já fornece um meio de contato/);
  assert.match(instructions, /Onix 2020/);
  assert.match(instructions, /Não pedir automaticamente placa, telefone, quilometragem ou versão/);
  assert.doesNotMatch(instructions, /\uFFFD|OlÃ|orÃ/);
});

test("throws the parse error when output_parsed is null or undefined", async () => {
  for (const output of [null, undefined]) {
    const { interpreter } = makeInterpreter(output);
    await assert.rejects(interpreter.interpret(makeInput()), {
      message: "AI response could not be parsed",
    });
  }
});

test("rejects malformed, incompatible and textual output without an unsafe fallback", async () => {
  for (const output of ["{broken", { intent: "QUOTE_REQUEST" }, { ...validModelOutput(), missingData: "placa" }, { ...validModelOutput(), extra: "unsupported" }]) {
    const { interpreter } = makeInterpreter(output);
    await assert.rejects(interpreter.interpret(makeInput()));
  }
});

test("preserves explicitly declared phone and plate through structured parsing", async () => {
  const output = validModelOutput();
  const { interpreter } = makeInterpreter({
    ...output,
    intent: Intent.GENERAL_INFORMATION,
    extractedCustomerData: { ...output.extractedCustomerData, primaryPhone: "11999999999" },
    extractedVehicleData: { ...output.extractedVehicleData, licensePlate: "ABC1D23" },
  });
  const result = await interpreter.interpret({ ...makeInput(), content: "Meu telefone é 11999999999 e a placa é ABC1D23." });
  assert.deepEqual(result.extractedCustomerData, { primaryPhone: "11999999999" });
  assert.deepEqual(result.extractedVehicleData, { licensePlate: "ABC1D23" });
  assert.deepEqual(result.missingData, []);
});

test("sends the workshop facts and the local time as data, and tells the model to answer only from them", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());
  const businessFacts = { address: "Rua A, 1", openingHours: { sábado: "08:00-12:00" }, services: ["Troca de óleo"], paymentMethods: ["Pix"] };

  await interpreter.interpret({ ...makeInput(), businessFacts, localDateTime: "2026-11-07 11:00 (sábado, America/Manaus)" });

  const request = capturedRequest(requests);
  const context = JSON.parse(request.input) as { businessFacts?: unknown; localDateTime?: string };
  assert.deepEqual(context.businessFacts, businessFacts);
  assert.equal(context.localDateTime, "2026-11-07 11:00 (sábado, America/Manaus)");
  assert.match(request.instructions, /businessFacts/);
  assert.match(request.instructions, /somente esses fatos/);
  assert.match(request.instructions, /UNKNOWN_INFORMATION/);
  assert.match(request.instructions, /Nunca informe preço/);
});

test("without registered facts the context is exactly what it was before", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());

  await interpreter.interpret(makeInput());

  assert.deepEqual(Object.keys(JSON.parse(capturedRequest(requests).input) as object), ["content", "history"]);
});

test("the prompt shared with Groq turns the acceptance of a price into an appointment request", () => {
  assert.match(INTERPRETER_INSTRUCTIONS, /ACEITE DE PREÇO[\s\S]*"sim", "pode fazer", "fechado"[\s\S]*intent = APPOINTMENT_REQUEST/);
});
