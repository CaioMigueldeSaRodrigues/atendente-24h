import assert from "node:assert/strict";
import { test } from "node:test";
import type { GoogleGenAI } from "@google/genai";
import { GeminiMessageInterpreter } from "../../src/integrations/gemini-message-interpreter.js";
import { Channel, Intent, SenderType } from "../../src/core/domain/enums.js";
import type { Message } from "../../src/core/domain/entities.js";

const modelOutput = {
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: {
    name: null,
    primaryPhone: null,
    email: null,
  },
  extractedVehicleData: {
    brand: "Toyota",
    model: "Corolla",
    year: 2020,
    version: null,
    licensePlate: null,
    mileage: null,
  },
  symptomDescription: null,
  requestedItem: "trocar as pastilhas de freio",
  missingData: [],
  suggestedNextAction: {
    type: "PROVIDE_QUOTE",
    description: "Preparar orçamento das pastilhas de freio.",
    dueAt: null,
    assignedTo: null,
  },
  requiresHuman: false,
  handoffReason: null,
  proposedResponse: "Vou verificar as informações para preparar o orçamento.",
  confidence: 0.9,
};

function createInterpreter(outputText: string | undefined) {
  let request: Record<string, unknown> | undefined;
  const create = async (parameters: Record<string, unknown>) => {
    request = parameters;
    return { output_text: outputText };
  };
  const client = {
    interactions: { create },
  } as unknown as GoogleGenAI;

  return {
    interpreter: new GeminiMessageInterpreter(client, "test-model"),
    getRequest: () => request,
  };
}

function createInput(): {
  businessId: string;
  conversationId: string;
  content: string;
  history: readonly Message[];
} {
  return {
    businessId: "business-1",
    conversationId: "conversation-1",
    content: "Tenho um Corolla 2020 e quero orçamento para trocar as pastilhas de freio.",
    history: [
      {
        id: "internal-message-id",
        businessId: "internal-business-id",
        conversationId: "internal-conversation-id",
        senderType: SenderType.CUSTOMER,
        channel: Channel.WHATSAPP,
        content: "Meu carro é um Corolla.",
        externalMessageId: "external-message-id",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    ],
  };
}

test("returns a valid AIInterpretation and omits nullable fields", async () => {
  const { interpreter } = createInterpreter(JSON.stringify(modelOutput));

  const result = await interpreter.interpret(createInput());

  assert.equal(result.intent, Intent.QUOTE_REQUEST);
  assert.equal(result.extractedVehicleData.model, "Corolla");
  assert.deepEqual(result.extractedCustomerData, {});
  assert.equal("symptomDescription" in result, false);
  assert.equal("handoffReason" in result, false);
  assert.equal("confidence" in result, true);
  assert.equal("dueAt" in result.suggestedNextAction, false);
});

test("uses the constructor model and sends only the reduced conversation context", async () => {
  const { interpreter, getRequest } = createInterpreter(JSON.stringify(modelOutput));
  const input = createInput();

  await interpreter.interpret(input);

  const request = getRequest();
  assert.equal(request?.model, "test-model");
  const context = JSON.parse(request?.input as string) as Record<string, unknown>;
  assert.equal(context.businessId, input.businessId);
  assert.equal(context.conversationId, input.conversationId);
  assert.equal(context.content, input.content);
  assert.deepEqual(context.history, [
    { senderType: SenderType.CUSTOMER, content: "Meu carro é um Corolla." },
  ]);
  assert.equal(JSON.stringify(context).includes("internal-message-id"), false);
  assert.equal(JSON.stringify(context).includes("createdAt"), false);
  assert.equal(JSON.stringify(context).includes("WHATSAPP"), false);
});

test("requests application/json with a schema generated from the interpretation schema", async () => {
  const { interpreter, getRequest } = createInterpreter(JSON.stringify(modelOutput));

  await interpreter.interpret(createInput());

  const responseFormat = getRequest()?.response_format as {
    type: string;
    mime_type: string;
    schema: { type?: string; properties?: Record<string, unknown> };
  };
  assert.equal(responseFormat.type, "text");
  assert.equal(responseFormat.mime_type, "application/json");
  assert.equal(responseFormat.schema.type, "object");
  assert.ok(responseFormat.schema.properties?.intent);
});

test("rejects missing or empty output_text with the parse error", async () => {
  for (const outputText of [undefined, "", "  "]) {
    const { interpreter } = createInterpreter(outputText);
    await assert.rejects(
      interpreter.interpret(createInput()),
      { message: "AI response could not be parsed" },
    );
  }
});

test("converts invalid JSON to the parse error", async () => {
  const { interpreter } = createInterpreter("{invalid json");

  await assert.rejects(
    interpreter.interpret(createInput()),
    { message: "AI response could not be parsed" },
  );
});

test("rejects structurally invalid output using the domain parser", async () => {
  const { interpreter } = createInterpreter(JSON.stringify({ ...modelOutput, intent: "NOT_AN_INTENT" }));

  await assert.rejects(interpreter.interpret(createInput()));
});
