import assert from "node:assert/strict";
import test from "node:test";
import { AiUsageMeasurementService, calculateAiCost, type AiModelPrice, type AiUsageEvent, type AiUsageStore } from "../../src/core/ai-usage.js";
import { createBasicPlanHttpServer, type BasicPlanHttpServerDependencies } from "../../src/infrastructure/http/basic-plan-http-server.js";

const price: AiModelPrice = {
  provider: "groq",
  model: "llama-test",
  pricingVersion: "2026-01",
  inputPricePerMillion: 0.5,
  cachedInputPricePerMillion: 0.1,
  outputPricePerMillion: 1.5,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
};

test("calculates uncached input, cached input, output and markup costs", () => {
  const result = calculateAiCost({
    inputTokens: 1_000_000,
    cachedInputTokens: 200_000,
    outputTokens: 100_000,
    price,
    fxRate: 5,
    markupMultiplier: 1.2,
  });
  assert.equal(result.costUsd, 0.57);
  assert.equal(result.costBrl, 2.85);
  assert.equal(result.billableBrl, 3.42);
});

test("does not charge cached input twice", () => {
  const result = calculateAiCost({
    inputTokens: 1_000,
    cachedInputTokens: 400,
    outputTokens: 200,
    price: {
      ...price,
      inputPricePerMillion: 0.075,
      cachedInputPricePerMillion: 0.0375,
      outputPricePerMillion: 0.3,
    },
    markupMultiplier: 1,
  });

  assert.equal(result.costUsd, 0.00012);
});

test("calculates the default smoke totals with sub-cent precision", () => {
  const result = calculateAiCost({
    inputTokens: 5_293,
    cachedInputTokens: 1_536,
    outputTokens: 2_945,
    price: {
      ...price,
      inputPricePerMillion: 0.075,
      cachedInputPricePerMillion: 0.0375,
      outputPricePerMillion: 0.3,
    },
    fxRate: 5,
    markupMultiplier: 1,
  });

  assert.equal(result.costUsd, 0.001222875);
  assert.equal(result.costBrl, 0.006114375);
  assert.equal(result.billableBrl, 0.006114375);
  assert.notEqual(result.costBrl, 0);
});

test("associates the event with the supplied business and persists the selected price version", async () => {
  const events: AiUsageEvent[] = [];
  const store: AiUsageStore = {
    findPrice: async () => price,
    append: async (event) => { events.push(event); },
  };
  const service = new AiUsageMeasurementService(store, { markupMultiplier: 1.1, usdBrlRate: 5 }, () => "usage-1", () => "2026-02-01T10:00:00.000Z");

  await service.record({
    businessId: "business-workshop-1",
    conversationId: "conversation-1",
    usage: {
      provider: "groq",
      model: "llama-test",
      inputTokens: 100,
      cachedInputTokens: 25,
      outputTokens: 50,
      totalTokens: 150,
      totalTimeMs: 120,
    },
  });

  assert.deepEqual(events[0], {
    id: "usage-1",
    businessId: "business-workshop-1",
    conversationId: "conversation-1",
    provider: "groq",
    model: "llama-test",
    inputTokens: 100,
    cachedInputTokens: 25,
    outputTokens: 50,
    totalTokens: 150,
    totalTimeMs: 120,
    costUsd: 0.000115,
    fxRate: 5,
    costBrl: 0.000575,
    billableBrl: 0.0006325,
    pricingVersion: "2026-01",
    status: "SUCCEEDED",
    createdAt: "2026-02-01T10:00:00.000Z",
  });
});

test("keeps historical pricing in each event when the active price changes", async () => {
  const events: AiUsageEvent[] = [];
  let currentPrice = price;
  const store: AiUsageStore = {
    findPrice: async () => currentPrice,
    append: async (event) => { events.push(event); },
  };
  const service = new AiUsageMeasurementService(store, { markupMultiplier: 1, usdBrlRate: 5 }, () => "usage-" + (events.length + 1));

  await service.record({
    businessId: "business-1",
    usage: { provider: "groq", model: "llama-test", inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0, totalTokens: 1_000_000, totalTimeMs: 1 },
    createdAt: "2026-01-31T23:59:00.000Z",
  });
  currentPrice = { ...price, pricingVersion: "2026-02", inputPricePerMillion: 2 };
  await service.record({
    businessId: "business-1",
    usage: { provider: "groq", model: "llama-test", inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0, totalTokens: 1_000_000, totalTimeMs: 1 },
    createdAt: "2026-02-01T00:00:00.000Z",
  });

  assert.equal(events[0]?.pricingVersion, "2026-01");
  assert.equal(events[0]?.costUsd, 0.5);
  assert.equal(events[1]?.pricingVersion, "2026-02");
  assert.equal(events[1]?.costUsd, 2);
});

test("keeps three business A events separate from two business B events and filters periods", async () => {
  const events: AiUsageEvent[] = [];
  const store: AiUsageStore = {
    findPrice: async () => ({
      ...price,
      inputPricePerMillion: 0.075,
      cachedInputPricePerMillion: 0.0375,
      outputPricePerMillion: 0.3,
    }),
    append: async (event) => { events.push(event); },
  };
  const service = new AiUsageMeasurementService(store, { markupMultiplier: 1, usdBrlRate: 5 }, () => `usage-${events.length + 1}`);
  const usage = { provider: "groq", model: "openai/gpt-oss-20b", inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 100, totalTokens: 1_100, totalTimeMs: 100 };

  for (let index = 0; index < 3; index += 1) {
    await service.record({ businessId: "business-a", usage, createdAt: `2026-01-0${index + 1}T00:00:00Z` });
  }
  for (let index = 0; index < 2; index += 1) {
    await service.record({ businessId: "business-b", usage, createdAt: `2026-02-0${index + 1}T00:00:00Z` });
  }

  const summarize = (businessId: string, from: string, to: string) => events
    .filter((event) => event.businessId === businessId && event.createdAt >= from && event.createdAt < to)
    .reduce((summary, event) => ({
      calls: summary.calls + 1,
      inputTokens: summary.inputTokens + event.inputTokens,
      cachedInputTokens: summary.cachedInputTokens + event.cachedInputTokens,
      outputTokens: summary.outputTokens + event.outputTokens,
      costUsd: summary.costUsd + (event.costUsd ?? 0),
    }), { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0 });

  assert.deepEqual(summarize("business-a", "2026-01-01", "2026-02-01"), {
    calls: 3, inputTokens: 3_000, cachedInputTokens: 600, outputTokens: 300, costUsd: 0.0002925,
  });
  assert.deepEqual(summarize("business-b", "2026-02-01", "2026-03-01"), {
    calls: 2, inputTokens: 2_000, cachedInputTokens: 400, outputTokens: 200, costUsd: 0.000195,
  });
  assert.equal(summarize("business-a", "2026-02-01", "2026-03-01").calls, 0);
});

test("exposes protected AI usage summary and monthly aggregation to the operator", async () => {
  const server = createBasicPlanHttpServer({
    operator: { businessId: "business-1", businessName: "Workshop", integratedQuotes: false },
    businessOperatorAuthorizer: { isAuthorized: async ({ businessId }: { businessId: string }) => businessId === "business-1" },
    aiUsageQueryService: {
      getSummary: async ({ businessId, period }: { businessId: string; period?: { from?: string; to?: string } }) => ({
        businessId, period: period ?? {}, calls: 1, inputTokens: 10, cachedInputTokens: 2, outputTokens: 3,
        totalTokens: 13, costUsd: 0.01, costBrl: 0.05, billableBrl: 0.06, averageLatencyMs: 20, errorCount: 0, errorRate: 0,
      }),
      getMonthly: async () => [{ month: "2026-01", calls: 1, inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, totalTokens: 13, costUsd: 0.01, costBrl: 0.05, billableBrl: 0.06, averageLatencyMs: 20, errorCount: 0, errorRate: 0 }],
    },
  } as unknown as BasicPlanHttpServerDependencies);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch("http://127.0.0.1:" + address.port + "/v1/businesses/business-1/ai-usage?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z");
    assert.equal(response.status, 200);
    const body = await response.json() as { summary: { businessId: string }; months: unknown[] };
    assert.equal(body.summary.businessId, "business-1");
    assert.equal(body.months.length, 1);
    const forbidden = await fetch("http://127.0.0.1:" + address.port + "/v1/businesses/other/ai-usage");
    assert.equal(forbidden.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
