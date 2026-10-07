import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { Intent, SenderType, Channel } from "../../src/core/domain/enums.js";
import type { Message } from "../../src/core/domain/entities.js";
import { OpenAIMessageInterpreter } from "../../src/integrations/openai-message-interpreter.js";

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

test("sends current content and only reduced conversation history", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());
  const input = makeInput();

  await interpreter.interpret(input);

  const request = capturedRequest(requests);
  const context = JSON.parse(request.input) as Record<string, unknown>;
  assert.deepEqual(Object.keys(context).sort(), ["businessId", "content", "conversationId", "history"]);
  assert.equal(context.businessId, "business-1");
  assert.equal(context.conversationId, "conversation-1");
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
