import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeMessageInterpreter, isGate3FakeInterpreterEnabled } from "../../src/app/runtime-message-interpreter.js";
import { Intent } from "../../src/core/domain/enums.js";

const input = {
  businessId: "business-gate3",
  conversationId: "conversation-gate3",
  content: "Teste Gate 3 - preciso de orçamento para troca de óleo.",
  history: [],
};

test("normal mode keeps using the configured LLM interpreter", async (t) => {
  const requests: Request[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    return Response.json({
      output: [{
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            intent: Intent.GENERAL_INFORMATION,
            extractedCustomerData: { name: null, primaryPhone: null, email: null },
            extractedVehicleData: { brand: null, model: null, year: null, version: null, licensePlate: null, mileage: null },
            symptomDescription: null,
            requestedItem: null,
            missingData: [],
            suggestedNextAction: { type: "NONE", description: "No action", dueAt: null, assignedTo: null },
            requiresHuman: false,
            handoffReason: null,
            proposedResponse: "Resposta do interpreter configurado.",
            confidence: 1,
          }),
        }],
      }],
    });
  });

  const interpreter = createRuntimeMessageInterpreter({
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "synthetic-key",
    OPENAI_MODEL: "configured-model",
  });
  const result = await interpreter.interpret(input);

  assert.equal(result.intent, Intent.GENERAL_INFORMATION);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.openai.com/v1/responses");
});

test("fake mode requires the explicit true flag", () => {
  assert.equal(isGate3FakeInterpreterEnabled({}), false);
  assert.equal(isGate3FakeInterpreterEnabled({ GATE3_FAKE_INTERPRETER: "false" }), false);
  assert.equal(isGate3FakeInterpreterEnabled({ GATE3_FAKE_INTERPRETER: "1" }), false);
  assert.equal(isGate3FakeInterpreterEnabled({ GATE3_FAKE_INTERPRETER: " true " }), true);
  assert.throws(() => createRuntimeMessageInterpreter({ GATE3_FAKE_INTERPRETER: "false" }), {
    message: "LLM_PROVIDER must be explicitly set to openai, openrouter or groq",
  });
});

test("fake mode has no contact/provider data and returns the exact Gate 3 quote intent", async () => {
  const interpretation = await createRuntimeMessageInterpreter({ GATE3_FAKE_INTERPRETER: "true" }).interpret(input);

  assert.deepEqual(interpretation, {
    intent: Intent.QUOTE_REQUEST,
    extractedCustomerData: {},
    extractedVehicleData: {},
    requestedItem: "Troca de óleo",
    missingData: [],
    suggestedNextAction: {
      type: "PROVIDE_QUOTE",
      description: "Aguardar autorização manual do orçamento no operador",
    },
    requiresHuman: false,
    proposedResponse: "Recebi seu pedido de orçamento para troca de óleo. A oficina vai confirmar o valor.",
    confidence: 1,
  });
  const serialized = JSON.stringify(interpretation);
  assert.doesNotMatch(serialized, /\+?\d{8,}/);
  assert.doesNotMatch(serialized, /jid|token/i);
});
