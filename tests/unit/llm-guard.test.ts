import assert from "node:assert/strict";
import test from "node:test";
import { LLM_SENDER_DAILY_MESSAGE_LIMIT, LLM_SENDER_MESSAGE_LIMIT, LLM_SENDER_WINDOW_MS, LlmGuard } from "../../src/core/llm-guard.js";

const start = "2026-01-02T00:00:00.000Z";

test("blocks the sender above the limit and frees it after the window", async () => {
  let now = start;
  const guard = new LlmGuard({ now: () => now });
  for (let call = 0; call < LLM_SENDER_MESSAGE_LIMIT; call += 1) assert.equal(await guard.allow("business-a", "sender-a"), true);
  assert.equal(await guard.allow("business-a", "sender-a"), false);
  assert.equal(await guard.allow("business-a", "sender-b"), true);
  assert.equal(await guard.allow("business-b", "sender-a"), true);
  now = new Date(Date.parse(start) + LLM_SENDER_WINDOW_MS).toISOString();
  assert.equal(await guard.allow("business-a", "sender-a"), true);
});

test("one sender gets 200 messages in 24 hours, however spaced they are, and others are not affected", async () => {
  assert.equal(LLM_SENDER_DAILY_MESSAGE_LIMIT, 200);
  let now = start;
  const guard = new LlmGuard({ now: () => now });
  const firstMs = Date.parse(start);
  const spacing = LLM_SENDER_WINDOW_MS + 1000;
  for (let call = 0; call < LLM_SENDER_DAILY_MESSAGE_LIMIT; call += 1) {
    now = new Date(firstMs + Math.floor(call / LLM_SENDER_MESSAGE_LIMIT) * spacing + call).toISOString();
    assert.equal(await guard.allow("business-a", "sender-a"), true, `call ${call}`);
  }
  now = new Date(firstMs + 11 * spacing).toISOString();
  assert.equal(await guard.allow("business-a", "sender-a"), false);
  assert.equal(await guard.allow("business-a", "sender-b"), true);
  now = new Date(firstMs + 24 * 60 * 60 * 1000 + LLM_SENDER_DAILY_MESSAGE_LIMIT).toISOString();
  assert.equal(await guard.allow("business-a", "sender-a"), true);
});

test("concurrent messages from one sender cannot pass the limit together", async () => {
  const guard = new LlmGuard({ now: () => start, countCallsSince: async () => 0 });
  const results = await Promise.all(Array.from({ length: 30 }, () => guard.allow("business-a", "sender-a")));
  assert.equal(results.filter(Boolean).length, LLM_SENDER_MESSAGE_LIMIT);
});

test("daily ceiling counts the last 24 hours of the business", async () => {
  const seen: Array<[string, string]> = [];
  let calls = 4;
  const guard = new LlmGuard({
    now: () => start,
    dailyCallsPerBusiness: 5,
    countCallsSince: async (businessId, since) => { seen.push([businessId, since]); return calls; },
  });
  assert.equal(await guard.allow("business-a", "sender-a"), true);
  calls = 5;
  assert.equal(await guard.allow("business-a", "sender-b"), false);
  assert.deepEqual(seen[0], ["business-a", "2026-01-01T00:00:00.000Z"]);
});
