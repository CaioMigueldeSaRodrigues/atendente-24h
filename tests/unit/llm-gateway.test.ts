import assert from "node:assert/strict";
import test from "node:test";
import { readLlmEnvironment } from "../../src/integrations/llm/llm-environment.js";
import { createMessageInterpreter } from "../../src/integrations/llm/create-message-interpreter.js";

for (const provider of ["openai", "openrouter"] as const) {
  const prefix = provider.toUpperCase();
  const model = provider === "openrouter" ? "openrouter/free" : "synthetic-model";
  const environment = { LLM_PROVIDER: provider, [`${prefix}_API_KEY`]: "synthetic-credential", [`${prefix}_MODEL`]: model };

  test(`${provider}: selects only the configured provider credentials and model`, () => {
    assert.deepEqual(readLlmEnvironment(environment), {
      provider, apiKey: "synthetic-credential", model,
      baseURL: provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1",
      defaultHeaders: {},
    });
  });

  for (const field of ["API_KEY", "MODEL"]) {
    for (const absent of [undefined, "", "   "]) {
      test(`${provider}: rejects absent ${field} (${String(absent)}) without exposing secrets`, () => {
        const input = { ...environment, [`${prefix}_${field}`]: absent, UNRELATED_SECRET: "never-expose-this" };
        assert.throws(() => readLlmEnvironment(input), { message: `${prefix}_${field} is required` });
      });
    }
  }

  test(`${provider}: factory uses the Responses API, selected gateway, model and structured output`, async (t) => {
    const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({ url: request.url, headers: request.headers, body: await request.json() as Record<string, unknown> });
      return Response.json({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({
        intent: "QUOTE_REQUEST",
        extractedCustomerData: { name: null, primaryPhone: null, email: null },
        extractedVehicleData: { brand: null, model: "Onix", year: 2020, version: null, licensePlate: null, mileage: null },
        requestedItem: "Troca de óleo", symptomDescription: null, missingData: [],
        suggestedNextAction: { type: "PROVIDE_QUOTE", description: "Encaminhar à oficina", dueAt: null, assignedTo: null },
        requiresHuman: false, handoffReason: null, proposedResponse: "A oficina confirmará o valor.", confidence: null,
      }) }] }] });
    });
    const config = readLlmEnvironment({ ...environment, OPENROUTER_HTTP_REFERER: "https://example.test", OPENROUTER_APP_NAME: "Ampliview" });
    const result = await createMessageInterpreter(config).interpret({ businessId: "synthetic", conversationId: "synthetic", content: "Olá. Quero orçamento para troca de óleo do meu Onix 2020.", history: [] });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, `${config.baseURL}/responses`);
    assert.equal(requests[0]!.headers.get("authorization"), "Bearer synthetic-credential");
    assert.equal(requests[0]!.headers.get("http-referer"), provider === "openrouter" ? "https://example.test" : null);
    assert.equal(requests[0]!.headers.get("x-title"), provider === "openrouter" ? "Ampliview" : null);
    assert.equal(requests[0]!.body.model, model);
    assert.equal(requests[0]!.body.store, false);
    assert.equal((requests[0]!.body.text as { format: { type: string } }).format.type, "json_schema");
    assert.equal(result.intent, "QUOTE_REQUEST");
    assert.equal(result.requestedItem, "Troca de óleo");
    assert.deepEqual(result.extractedVehicleData, { model: "Onix", year: 2020 });
  });

  test(`${provider}: external failure does not fall back to another provider`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return Response.json({ error: { message: "Synthetic unavailable" } }, { status: 503 });
    });
    await assert.rejects(createMessageInterpreter(readLlmEnvironment(environment)).interpret({ businessId: "synthetic", conversationId: "synthetic", content: "Olá", history: [] }));
    assert.equal(calls, 1);
  });
}

for (const provider of [undefined, "", "   ", "OPENAI", "invalid-secret-value"]) {
  test(`rejects invalid provider without echoing its value (${provider === undefined ? "absent" : provider.length})`, () => {
    assert.throws(() => readLlmEnvironment({ LLM_PROVIDER: provider, OPENAI_API_KEY: "never-expose-this", OPENROUTER_API_KEY: "never-expose-that" }), {
      message: "LLM_PROVIDER must be explicitly set to openai, openrouter or groq",
    });
  });
}

test("groq: selects its credentials, endpoint and inference metrics header", () => {
  assert.deepEqual(readLlmEnvironment({
    LLM_PROVIDER: "groq",
    GROQ_API_KEY: "synthetic-credential",
    GROQ_MODEL: "synthetic-groq-model",
  }), {
    provider: "groq",
    apiKey: "synthetic-credential",
    model: "synthetic-groq-model",
    baseURL: "https://api.groq.com/openai/v1",
    defaultHeaders: { "Groq-Beta": "inference-metrics" },
  });
});

for (const field of ["GROQ_API_KEY", "GROQ_MODEL"]) {
  test(`groq: rejects absent ${field}`, () => {
    assert.throws(() => readLlmEnvironment({
      LLM_PROVIDER: "groq",
      GROQ_API_KEY: "synthetic-credential",
      GROQ_MODEL: "synthetic-groq-model",
      [field]: "   ",
    }), {
      message: `${field} is required`,
    });
  });
}

test("groq: factory uses Chat Completions, configured base URL and structured output", async (t) => {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const usageEvents: Array<{ businessId: string; conversationId?: string; usage: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, headers: request.headers, body: await request.json() as Record<string, unknown> });
    return Response.json({
      id: "chatcmpl-factory-groq",
      choices: [{ message: { content: JSON.stringify({
        intent: "QUOTE_REQUEST",
        extractedCustomerData: { name: null, primaryPhone: null, email: null },
        extractedVehicleData: { brand: null, model: "Onix", year: 2020, version: null, licensePlate: null, mileage: null },
        symptomDescription: null, requestedItem: "Troca de óleo", missingData: [],
        suggestedNextAction: { type: "PROVIDE_QUOTE", description: "Encaminhar à oficina", dueAt: null, assignedTo: null },
        requiresHuman: false, handoffReason: null, proposedResponse: "A oficina confirmará o valor.", confidence: null,
      }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      x_groq: { id: "req-factory-groq" },
    });
  });
  const config = readLlmEnvironment({
    LLM_PROVIDER: "groq",
    GROQ_API_KEY: "synthetic-credential",
    GROQ_MODEL: "synthetic-groq-model",
  });

  const result = await createMessageInterpreter(config, {
    async record(event) { usageEvents.push(event as typeof usageEvents[number]); },
  }).interpret({
    businessId: "business-factory",
    conversationId: "conversation-factory",
    content: "Quero orçamento para troca de óleo.",
    history: [],
  });

  assert.equal(result.intent, "QUOTE_REQUEST");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(requests[0]!.headers.get("authorization"), "Bearer synthetic-credential");
  assert.equal(requests[0]!.headers.get("groq-beta"), "inference-metrics");
  assert.equal(requests[0]!.body.model, "synthetic-groq-model");
  assert.equal((requests[0]!.body.response_format as { type: string }).type, "json_schema");
  assert.equal(usageEvents[0]?.businessId, "business-factory");
  assert.equal(usageEvents[0]?.conversationId, "conversation-factory");
  assert.equal(usageEvents[0]?.usage.provider, "groq");
  assert.equal(usageEvents[0]?.usage.providerRequestId, "req-factory-groq");
});
