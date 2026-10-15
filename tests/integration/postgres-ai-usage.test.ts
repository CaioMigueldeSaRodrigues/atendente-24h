import assert from "node:assert/strict";
import test from "node:test";
import { AiUsageMeasurementService } from "../../src/core/ai-usage.js";
import { PostgresDatabase, type PostgresEnvironment } from "../../src/infrastructure/postgres/postgres-database.js";
import { applyPostgresMigrations } from "../../src/infrastructure/postgres/postgres-migrations.js";
import { PostgresAiUsageRepository } from "../../src/infrastructure/postgres/postgres-ai-usage-repository.js";

const config: PostgresEnvironment = {
  host: process.env.POSTGRES_TEST_HOST ?? "",
  port: Number(process.env.POSTGRES_TEST_PORT ?? 5432),
  database: process.env.POSTGRES_TEST_DATABASE ?? "",
  user: process.env.POSTGRES_TEST_USER ?? "",
  password: process.env.POSTGRES_TEST_PASSWORD ?? "",
};
const enabled = Boolean(
  process.env.POSTGRES_TEST_HOST
  && process.env.POSTGRES_TEST_DATABASE
  && /(?:test|ci|dev)/i.test(process.env.POSTGRES_TEST_DATABASE)
  && process.env.POSTGRES_TEST_USER
  && process.env.POSTGRES_TEST_PASSWORD,
);

test("PostgreSQL AI usage aggregates monthly and keeps historical pricing", { skip: !enabled }, async () => {
  const admin = new PostgresDatabase(config, { allowInsecureLocal: true });
  const schema = "att24_ai_usage_" + process.pid + "_" + Date.now();
  await admin.query("CREATE SCHEMA " + JSON.stringify(schema).replace(/^"|"$/g, '"'));
  const database = new PostgresDatabase(config, { allowInsecureLocal: true, searchPath: schema });
  const businessId = "business-ai-usage";
  try {
    await applyPostgresMigrations(database);
    await database.query("INSERT INTO automotive_businesses(id,name,business_type,timezone,active,created_at,updated_at) VALUES($1,$1,'OTHER','UTC',true,$2,$2)", [businessId, "2026-01-01T00:00:00Z"]);
    await database.query("INSERT INTO conversations(id,business_id,channel,status,started_at,last_message_at) VALUES($1,$2,'WEB','ACTIVE',$3,$3)", ["conversation-1", businessId, "2026-01-01T00:00:00Z"]);
    await database.query("INSERT INTO ai_model_prices(provider,model,pricing_version,input_price_per_million,cached_input_price_per_million,output_price_per_million,effective_from,effective_to) VALUES ('groq','llama-test','v1',1,0.5,2,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z'), ('groq','llama-test','v2',3,1.5,4,'2026-02-01T00:00:00Z',NULL)");
    const repository = new PostgresAiUsageRepository(database);
    let sequence = 0;
    const service = new AiUsageMeasurementService(repository, { markupMultiplier: 2, usdBrlRate: 5 }, () => "usage-" + (++sequence));
    const usage = { provider: "groq", model: "llama-test", inputTokens: 1_000_000, cachedInputTokens: 100_000, outputTokens: 100_000, totalTokens: 1_100_000, totalTimeMs: 100 };
    await service.record({ businessId, conversationId: "conversation-1", usage, createdAt: "2026-01-15T00:00:00Z" });
    await service.record({ businessId, conversationId: "conversation-1", usage: { ...usage, totalTimeMs: 300 }, createdAt: "2026-02-15T00:00:00Z" });

    const monthly = await repository.getMonthly({ businessId, period: { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" } });
    assert.deepEqual(monthly.map(({ month, calls, costUsd, billableBrl }) => ({ month, calls, costUsd, billableBrl })), [
      { month: "2026-01", calls: 1, costUsd: 1.15, billableBrl: 11.5 },
      { month: "2026-02", calls: 1, costUsd: 3.25, billableBrl: 32.5 },
    ]);
    const summary = await repository.getSummary({ businessId, period: { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" } });
    assert.equal(summary.calls, 2);
    assert.equal(summary.averageLatencyMs, 200);
    assert.equal(summary.inputTokens, 2_000_000);
  } finally {
    await database.close();
    await admin.query("DROP SCHEMA IF EXISTS " + JSON.stringify(schema).replace(/^"|"$/g, '"') + " CASCADE");
    await admin.close();
  }
});

test("PostgreSQL AI usage isolates businesses and validates the seeded Groq price", { skip: !enabled }, async () => {
  const admin = new PostgresDatabase(config, { allowInsecureLocal: true });
  const schema = "att24_ai_usage_isolation_" + process.pid + "_" + Date.now();
  await admin.query("CREATE SCHEMA " + JSON.stringify(schema).replace(/^"|"$/g, '"'));
  const database = new PostgresDatabase(config, { allowInsecureLocal: true, searchPath: schema });
  const businessA = "business-a";
  const businessB = "business-b";
  try {
    await applyPostgresMigrations(database);
    for (const businessId of [businessA, businessB]) {
      await database.query("INSERT INTO automotive_businesses(id,name,business_type,timezone,active,created_at,updated_at) VALUES($1,$1,'OTHER','UTC',true,$2,$2)", [businessId, "2026-01-01T00:00:00Z"]);
      await database.query("INSERT INTO conversations(id,business_id,channel,status,started_at,last_message_at) VALUES($1,$2,'WEB','ACTIVE',$3,$3)", [`${businessId}-conversation`, businessId, "2026-01-01T00:00:00Z"]);
    }

    const seededPrice = await new PostgresAiUsageRepository(database).findPrice({
      provider: "groq", model: "openai/gpt-oss-20b", at: "2026-10-15T12:00:00Z",
    });
    assert.deepEqual(seededPrice && {
      inputPricePerMillion: seededPrice.inputPricePerMillion,
      cachedInputPricePerMillion: seededPrice.cachedInputPricePerMillion,
      outputPricePerMillion: seededPrice.outputPricePerMillion,
    }, { inputPricePerMillion: 0.075, cachedInputPricePerMillion: 0.0375, outputPricePerMillion: 0.3 });

    await database.query("INSERT INTO ai_model_prices(provider,model,pricing_version,input_price_per_million,cached_input_price_per_million,output_price_per_million,effective_from,effective_to) VALUES ('groq','isolation-test','v1',0.075,0.0375,0.3,'2026-01-01T00:00:00Z',NULL)");
    const repository = new PostgresAiUsageRepository(database);
    let sequence = 0;
    const service = new AiUsageMeasurementService(repository, { markupMultiplier: 1, usdBrlRate: 5 }, () => `isolation-${++sequence}`);
    const usage = { provider: "groq", model: "isolation-test", inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 100, totalTokens: 1_100, totalTimeMs: 100 };
    for (let index = 0; index < 3; index += 1) {
      await service.record({ businessId: businessA, conversationId: `${businessA}-conversation`, usage, createdAt: `2026-01-0${index + 1}T00:00:00Z` });
    }
    for (let index = 0; index < 2; index += 1) {
      await service.record({ businessId: businessB, conversationId: `${businessB}-conversation`, usage, createdAt: `2026-02-0${index + 1}T00:00:00Z` });
    }

    const monthlyA = await repository.getMonthly({ businessId: businessA, period: { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" } });
    const monthlyB = await repository.getMonthly({ businessId: businessB, period: { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" } });
    assert.deepEqual(monthlyA.map(({ month, calls, inputTokens, cachedInputTokens, outputTokens, costUsd }) => ({ month, calls, inputTokens, cachedInputTokens, outputTokens, costUsd })), [
      { month: "2026-01", calls: 3, inputTokens: 3_000, cachedInputTokens: 600, outputTokens: 300, costUsd: 0.0002925 },
    ]);
    assert.deepEqual(monthlyB.map(({ month, calls, inputTokens, cachedInputTokens, outputTokens, costUsd }) => ({ month, calls, inputTokens, cachedInputTokens, outputTokens, costUsd })), [
      { month: "2026-02", calls: 2, inputTokens: 2_000, cachedInputTokens: 400, outputTokens: 200, costUsd: 0.000195 },
    ]);
    assert.equal((await repository.getSummary({ businessId: businessA, period: { from: "2026-02-01T00:00:00Z", to: "2026-03-01T00:00:00Z" } })).calls, 0);
  } finally {
    await database.close();
    await admin.query("DROP SCHEMA IF EXISTS " + JSON.stringify(schema).replace(/^"|"$/g, '"') + " CASCADE");
    await admin.close();
  }
});
