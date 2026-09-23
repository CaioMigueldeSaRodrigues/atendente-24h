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
  businessId: "business-1",
  conversationId: "conversation-1",
  senderType: SenderType.CUSTOMER,
  channel: Channel.WEB,
  content: "Meu carro precisa de pastilhas.",
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
    interpreter: new OpenAIMessageInterpreter(client, "test-model"),
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
  input: string;
  text: {
    format: {
      name: string;
      type: string;
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

test("throws when output_parsed is null", async () => {
  const { interpreter } = makeInterpreter(null);

  await assert.rejects(interpreter.interpret(makeInput()), {
    message: "AI response could not be parsed",
  });
});

test("sends the configured model to Responses API", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());

  await interpreter.interpret(makeInput());

  assert.equal(capturedRequest(requests).model, "test-model");
});

test("sends current content and conversation history in the context", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());

  await interpreter.interpret(makeInput());

  const context = JSON.parse(capturedRequest(requests).input) as {
    businessId: string;
    conversationId: string;
    content: string;
    history: Array<{ senderType: SenderType; content: string }>;
  };
  assert.equal(context.businessId, "business-1");
  assert.equal(context.conversationId, "conversation-1");
  assert.equal(context.content, "Quero orçamento para pastilhas.");
  assert.deepEqual(context.history, [
    {
      senderType: SenderType.CUSTOMER,
      content: "Meu carro precisa de pastilhas.",
    },
  ]);
});

test("does not send per-message identifiers in model context", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());

  await interpreter.interpret(makeInput());

  const request = capturedRequest(requests);
  assert.equal(request.input.includes("message-internal-id"), false);
  assert.equal(request.input.includes("createdAt"), false);
  assert.equal(request.input.includes('"channel"'), false);
});

test("uses the Structured Output schema format", async () => {
  const { interpreter, requests } = makeInterpreter(validModelOutput());

  await interpreter.interpret(makeInput());

  const format = capturedRequest(requests).text.format;
  assert.equal(format.name, "automotive_interpretation");
  assert.equal(format.type, "json_schema");
});
