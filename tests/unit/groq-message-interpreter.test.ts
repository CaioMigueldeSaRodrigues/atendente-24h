import assert from "node:assert/strict";
import { test } from "node:test";
import OpenAI from "openai";
import { GroqMessageInterpreter } from "../../src/integrations/groq-message-interpreter.js";
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

function createInterpreter(content: string | null | undefined) {
  let request: Record<string, unknown> | undefined;
  const create = async (parameters: Record<string, unknown>) => {
    request = parameters;
    return {
      choices: content === undefined
        ? []
        : [{ message: { content } }],
    };
  };
  const client = {
    chat: { completions: { create } },
  } as unknown as OpenAI;

  return {
    interpreter: new GroqMessageInterpreter(client, "test-model"),
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

test("returns valid AIInterpretation and maps null values to absent properties", async () => {
  const { interpreter } = createInterpreter(JSON.stringify(modelOutput));

  const result = await interpreter.interpret(createInput());

  assert.equal(result.intent, Intent.QUOTE_REQUEST);
  assert.equal(result.extractedVehicleData.model, "Corolla");
  assert.deepEqual(result.extractedCustomerData, {});
  assert.equal("symptomDescription" in result, false);
  assert.equal("handoffReason" in result, false);
  assert.equal("dueAt" in result.suggestedNextAction, false);
});

test("uses the configured model and sends current content with reduced history", async () => {
  const { interpreter, getRequest } = createInterpreter(JSON.stringify(modelOutput));
  const input = createInput();

  await interpreter.interpret(input);

  const request = getRequest();
  assert.equal(request?.model, "test-model");
  const messages = request?.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[1]?.role, "user");
  const context = JSON.parse(messages[1]?.content ?? "") as Record<string, unknown>;
  assert.equal(context.businessId, input.businessId);
  assert.equal(context.conversationId, input.conversationId);
  assert.equal(context.content, input.content);
  assert.deepEqual(context.history, [
    { senderType: SenderType.CUSTOMER, content: "Meu carro é um Corolla." },
  ]);
  for (const excluded of [
    "internal-message-id",
    "internal-business-id",
    "internal-conversation-id",
    "external-message-id",
    "createdAt",
    "WHATSAPP",
  ]) {
    assert.equal(JSON.stringify(context).includes(excluded), false);
  }
});

test("requests strict json_schema Structured Output with closed object schemas", async () => {
  const { interpreter, getRequest } = createInterpreter(JSON.stringify(modelOutput));

  await interpreter.interpret(createInput());

  const responseFormat = getRequest()?.response_format as {
    type: string;
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  assert.equal(responseFormat.type, "json_schema");
  assert.equal(responseFormat.json_schema.name, "automotive_interpretation");
  assert.equal(responseFormat.json_schema.strict, true);
  assert.equal("$schema" in responseFormat.json_schema.schema, false);

  const schema = responseFormat.json_schema.schema;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  assert.equal(schema.additionalProperties, false);
  assert.equal(properties.extractedCustomerData?.additionalProperties, false);
  assert.equal(properties.extractedVehicleData?.additionalProperties, false);
  assert.equal(properties.suggestedNextAction?.additionalProperties, false);
});

test("rejects missing or empty completion content with the parse error", async () => {
  for (const content of [undefined, null, "", "  "]) {
    const { interpreter } = createInterpreter(content);
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

test("rejects structurally invalid output with the domain parser", async () => {
  const { interpreter } = createInterpreter(
    JSON.stringify({ ...modelOutput, intent: "NOT_AN_INTENT" }),
  );

  await assert.rejects(interpreter.interpret(createInput()));
});
