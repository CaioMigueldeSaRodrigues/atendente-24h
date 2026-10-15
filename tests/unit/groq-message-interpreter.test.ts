import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { Intent } from "../../src/core/domain/enums.js";
import { GroqMessageInterpreter } from "../../src/integrations/groq-message-interpreter.js";

const validModelOutput = () => ({
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: { name: null, primaryPhone: null, email: null },
  extractedVehicleData: {
    brand: null,
    model: "Onix",
    year: 2020,
    version: null,
    licensePlate: null,
    mileage: null,
  },
  symptomDescription: null,
  requestedItem: "Troca de óleo",
  missingData: [],
  suggestedNextAction: {
    type: "PROVIDE_QUOTE",
    description: "Encaminhar à oficina",
    dueAt: null,
    assignedTo: null,
  },
  requiresHuman: false,
  handoffReason: null,
  proposedResponse: "A oficina confirmará o valor.",
  confidence: 0.9,
});

const input = {
  businessId: "business-groq",
  conversationId: "conversation-groq",
  content: "Quero orçamento para troca de óleo do meu Onix 2020.",
  history: [],
};

function makeClient(response: unknown, requests: unknown[] = []): OpenAI {
  return {
    chat: {
      completions: {
        async create(request: unknown) {
          requests.push(request);
          return response;
        },
      },
    },
  } as unknown as OpenAI;
}

test("uses Groq Chat Completions structured output and current interpretation rules", async () => {
  const requests: unknown[] = [];
  const interpreter = new GroqMessageInterpreter(
    makeClient({
      id: "chatcmpl-groq-1",
      choices: [{ message: { content: JSON.stringify(validModelOutput()) } }],
      usage: {
        queue_time: 0.001,
        prompt_tokens: 100,
        prompt_tokens_details: { cached_tokens: 25 },
        prompt_time: 0.002,
        completion_tokens: 40,
        completion_time: 0.003,
        total_tokens: 140,
        total_time: 0.006,
      },
      x_groq: { id: "req-groq-1" },
    }, requests),
    "llama-test",
  );

  const result = await interpreter.interpret(input);
  const request = requests[0] as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format: { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } };
  };

  assert.equal(result.intent, Intent.QUOTE_REQUEST);
  assert.equal(result.extractedVehicleData.model, "Onix");
  assert.equal(request.model, "llama-test");
  assert.equal(request.response_format.type, "json_schema");
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.response_format.json_schema.schema.additionalProperties, false);
  assert.equal(request.response_format.json_schema.schema["$schema"], undefined);
  assert.match(request.messages[0]!.content, /MINIMIZA/);
  assert.match(request.messages[0]!.content, /UNKNOWN_INFORMATION/);
  assert.match(request.messages[0]!.content, /Nunca invente/);
  assert.deepEqual(JSON.parse(request.messages[1]!.content), input);
});

test("records real Groq usage with business, conversation and provider request id", async () => {
  const usageEvents: Array<{ businessId: string; conversationId?: string; usage: Record<string, unknown> }> = [];
  const interpreter = new GroqMessageInterpreter(makeClient({
    id: "chatcmpl-groq-2",
    choices: [{ message: { content: JSON.stringify(validModelOutput()) } }],
    usage: {
      prompt_tokens: 120,
      prompt_tokens_details: { cached_tokens: 20 },
      completion_tokens: 30,
      total_tokens: 150,
      queue_time: 0.004,
      prompt_time: 0.005,
      completion_time: 0.006,
      total_time: 0.015,
    },
    x_groq: { id: "req-groq-2" },
  }), "llama-test", {
    provider: "groq",
    usageRecorder: {
      async record(event) { usageEvents.push(event as typeof usageEvents[number]); },
    },
  });

  await interpreter.interpret(input);

  assert.equal(usageEvents.length, 1);
  assert.equal(usageEvents[0]?.businessId, "business-groq");
  assert.equal(usageEvents[0]?.conversationId, "conversation-groq");
  assert.equal(usageEvents[0]?.usage.provider, "groq");
  assert.equal(usageEvents[0]?.usage.model, "llama-test");
  assert.equal(usageEvents[0]?.usage.providerRequestId, "req-groq-2");
  assert.equal(usageEvents[0]?.usage.inputTokens, 120);
  assert.equal(usageEvents[0]?.usage.cachedInputTokens, 20);
  assert.equal(usageEvents[0]?.usage.outputTokens, 30);
  assert.equal(usageEvents[0]?.usage.totalTokens, 150);
  assert.equal(usageEvents[0]?.usage.queueTimeMs, 4);
  assert.equal(usageEvents[0]?.usage.promptTimeMs, 5);
  assert.equal(usageEvents[0]?.usage.completionTimeMs, 6);
  assert.equal(usageEvents[0]?.usage.totalTimeMs, 15);
});

test("records failed Groq calls and rethrows the provider error", async () => {
  const usageEvents: Array<{ usage: Record<string, unknown> }> = [];
  const interpreter = new GroqMessageInterpreter({
    chat: { completions: { async create() { throw new Error("Groq unavailable"); } } },
  } as unknown as OpenAI, "llama-test", {
    usageRecorder: {
      async record(event) { usageEvents.push(event as typeof usageEvents[number]); },
    },
  });

  await assert.rejects(interpreter.interpret(input), { message: "Groq unavailable" });
  assert.equal(usageEvents[0]?.usage.provider, "groq");
  assert.equal(usageEvents[0]?.usage.status, "FAILED");
  assert.equal(usageEvents[0]?.usage.errorCode, "AI_REQUEST_FAILED");
});

test("retries json_validate_failed exactly once and records both attempts", async () => {
  const usageEvents: Array<{ usage: Record<string, unknown> }> = [];
  let calls = 0;
  const interpreter = new GroqMessageInterpreter({
    chat: { completions: { async create() {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("structured output rejected"), { code: "json_validate_failed", status: 400 });
      return { id: "chatcmpl-retry", choices: [{ message: { content: JSON.stringify(validModelOutput()) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, x_groq: { id: "req-retry" } };
    } } },
  } as unknown as OpenAI, "llama-test", {
    usageRecorder: { async record(event) { usageEvents.push(event as typeof usageEvents[number]); } },
  });

  const result = await interpreter.interpret(input);

  assert.equal(result.intent, Intent.QUOTE_REQUEST);
  assert.equal(calls, 2);
  assert.equal(usageEvents.length, 2);
  assert.equal(usageEvents[0]?.usage.status, "FAILED");
  assert.equal(usageEvents[0]?.usage.errorCode, "JSON_VALIDATE_FAILED");
  assert.equal(usageEvents[1]?.usage.status, undefined);
  assert.equal(usageEvents[1]?.usage.providerRequestId, "req-retry");
  assert.equal(usageEvents[1]?.usage.totalTokens, 15);
});

test("does not retry rate limits and preserves the failed attempt", async () => {
  const usageEvents: Array<{ usage: Record<string, unknown> }> = [];
  let calls = 0;
  const error = Object.assign(new Error("rate limited"), { code: "rate_limit_exceeded", status: 429 });
  const interpreter = new GroqMessageInterpreter({
    chat: { completions: { async create() { calls += 1; throw error; } } },
  } as unknown as OpenAI, "llama-test", {
    usageRecorder: { async record(event) { usageEvents.push(event as typeof usageEvents[number]); } },
  });

  await assert.rejects(interpreter.interpret(input), { message: "rate limited" });
  assert.equal(calls, 1);
  assert.equal(usageEvents.length, 1);
  assert.equal(usageEvents[0]?.usage.status, "FAILED");
  assert.equal(usageEvents[0]?.usage.errorCode, "AI_REQUEST_FAILED");
});

test("does not invalidate a valid answer when usage telemetry fails", async () => {
  let observedFailure: unknown;
  const interpreter = new GroqMessageInterpreter(makeClient({
    choices: [{ message: { content: JSON.stringify(validModelOutput()) } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), "llama-test", {
    usageRecorder: { async record() { throw new Error("database unavailable"); } },
    onUsageRecordingFailure(error) {
      observedFailure = error;
      throw new Error("observer unavailable");
    },
  });

  const result = await interpreter.interpret(input);

  assert.equal(result.intent, Intent.QUOTE_REQUEST);
  assert.equal((observedFailure as Error).message, "database unavailable");
});
