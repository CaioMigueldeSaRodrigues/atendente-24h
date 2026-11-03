import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createBasicPlanRuntime } from "../../src/app/basic-plan-runtime.js";
import { BusinessType, Channel, Intent } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { LLM_LIMITED_REPLY, UNSUPPORTED_MESSAGE_REPLY } from "../../src/core/response-policy.js";
import { LLM_SENDER_MESSAGE_LIMIT } from "../../src/core/llm-guard.js";
import { MAX_MESSAGE_CHARS } from "../../src/core/process-message.js";
import { BasicBusinessOperatorAuthorizer } from "../../src/infrastructure/http/basic-business-operator-authorizer.js";

const businessId = "business-a";
const password = randomUUID();
const token = randomUUID();
const authorization = `Basic ${Buffer.from(`operator:${password}`).toString("base64")}`;
const webhookPath = "/v1/channels/whatsapp/evolution-go/webhook";
const interpretation: AIInterpretation = {
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: { name: "<img src=x onerror=alert(1)> Injetado" },
  extractedVehicleData: {},
  requestedItem: "troca de óleo",
  missingData: [],
  suggestedNextAction: { type: "PROVIDE_QUOTE", description: "x" },
  requiresHuman: false,
  proposedResponse: "ok",
};

async function withServer(options: { publicOrigin?: string }, run: (context: {
  base: string;
  calls: string[];
  sent: Array<{ recipientJid: string; content: string }>;
  json: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
  operator: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
}) => Promise<void>) {
  const calls: string[] = [];
  const sent: Array<{ recipientJid: string; content: string }> = [];
  const runtime = await createBasicPlanRuntime({
    databasePath: ":memory:",
    interpreter: { interpret: async ({ content }) => { calls.push(content); return interpretation; } },
    ...options,
    business: { businessId, businessName: "Oficina", businessType: BusinessType.OTHER, timezone: "UTC" },
    businessOperatorAuthorizer: new BasicBusinessOperatorAuthorizer(businessId, "operator", password),
    evolutionGoWebhookCredential: { businessId, instanceName: "instance", instanceToken: token },
    evolutionGoTextSender: { sendText: async (message) => { sent.push(message); } },
  });
  await new Promise<void>((resolve) => { runtime.server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const json = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const operator = (path: string, body: unknown, headers: Record<string, string> = {}) => json(path, body, { authorization, ...headers });
  try {
    await run({ base, calls, sent, json, operator });
  } finally {
    await runtime.close();
  }
}

const webhook = (Info: Record<string, unknown>, Message: Record<string, unknown>) => ({
  event: "Message",
  instanceName: "instance",
  instanceToken: token,
  data: {
    Info: { ID: randomUUID(), Type: "text", Sender: "5592999990000@s.whatsapp.net", Timestamp: new Date().toISOString(), IsFromMe: false, IsGroup: false, ...Info },
    Message,
  },
});

async function createConversation(operator: (path: string, body: unknown) => Promise<Response>): Promise<string> {
  const response = await operator(`/v1/businesses/${businessId}/conversations`, { channel: Channel.WEB });
  assert.equal(response.status, 201);
  return (await response.json() as { conversationId: string }).conversationId;
}

test("pentest A1, A2, A4 and A6: no anonymous conversation, message or LLM call", async () => {
  await withServer({}, async ({ base, calls, json, operator }) => {
    assert.equal((await json(`/v1/businesses/${businessId}/conversations`, { channel: Channel.WEB })).status, 404);
    assert.equal((await json(`/v1/businesses/${businessId}/conversations`, { channel: Channel.WHATSAPP })).status, 404);
    const conversationId = await createConversation(operator);
    const path = `/v1/businesses/${businessId}/conversations/${conversationId}/messages`;
    assert.equal((await json(path, { content: "quero orcamento" })).status, 404);
    const flood = await Promise.all(Array.from({ length: 200 }, () => json(path, { content: "spam" })));
    assert.deepEqual([...new Set(flood.map(({ status }) => status))], [404]);
    assert.equal(calls.length, 0);
    assert.equal((await fetch(base + path, { headers: { authorization } }).then((response) => response.json()) as { messages: unknown[] }).messages.length, 0);
  });
});

test("pentest A3: messages above the limit are refused before reaching the LLM", async () => {
  await withServer({}, async ({ calls, operator, json }) => {
    const conversationId = await createConversation(operator);
    const path = `/v1/businesses/${businessId}/conversations/${conversationId}/messages`;
    assert.equal((await json(path, { content: "x".repeat(900_000) })).status, 404);
    assert.equal((await operator(path, { content: "x".repeat(MAX_MESSAGE_CHARS + 1) })).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await operator(path, { content: "x".repeat(MAX_MESSAGE_CHARS) })).status, 200);
    assert.equal(calls[0]!.length, MAX_MESSAGE_CHARS);
  });
});

test("pentest A4 with a valid credential: the sender limit caps LLM calls", async () => {
  await withServer({}, async ({ calls, operator }) => {
    const conversationId = await createConversation(operator);
    const path = `/v1/businesses/${businessId}/conversations/${conversationId}/messages`;
    const responses = await Promise.all(Array.from({ length: 30 }, () => operator(path, { content: "spam" })));
    const replies = await Promise.all(responses.map((response) => response.json() as Promise<{ reply: string }>));
    assert.equal(calls.length, LLM_SENDER_MESSAGE_LIMIT);
    assert.equal(replies.filter(({ reply }) => reply === LLM_LIMITED_REPLY).length, 30 - LLM_SENDER_MESSAGE_LIMIT);
  });
});

test("pentest A5: an anonymous caller cannot put a fake order in the operator queue", async () => {
  await withServer({}, async ({ base, json }) => {
    await json(`/v1/businesses/${businessId}/conversations`, { channel: Channel.WEB });
    const queue = await fetch(`${base}/v1/businesses/${businessId}/quotes/pending`, { headers: { authorization } });
    assert.deepEqual(await queue.json(), { items: [] });
  });
});

test("JSON routes require the content type and refuse a foreign Origin, webhooks are exempt", async () => {
  await withServer({}, async ({ base, json, operator, sent }) => {
    const path = `/v1/businesses/${businessId}/conversations`;
    const asText = await fetch(base + path, { method: "POST", headers: { authorization, "content-type": "text/plain" }, body: JSON.stringify({ channel: Channel.WEB }) });
    assert.equal(asText.status, 415);
    assert.equal((await fetch(base + path, { method: "POST", headers: { authorization }, body: new Uint8Array() })).status, 415);
    assert.equal((await operator(path, { channel: Channel.WEB }, { "content-type": "application/json; charset=utf-8" })).status, 201);

    assert.equal((await operator(path, { channel: Channel.WEB }, { origin: "https://evil.example" })).status, 403);
    assert.equal((await operator(path, { channel: Channel.WEB }, { origin: "null" })).status, 403);
    assert.equal((await operator(path, { channel: Channel.WEB }, { origin: base })).status, 201);
    assert.equal((await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } })).status, 200);

    const payload = webhook({}, { conversation: "Oi" });
    const fromProvider = await fetch(base + webhookPath, { method: "POST", headers: { "content-type": "text/plain", origin: "https://provider.example" }, body: JSON.stringify(payload) });
    assert.equal(fromProvider.status, 202);
    assert.equal(sent.length, 1);
    assert.equal((await json("/v1/payments/mercadopago/webhook", {}, { origin: "https://evil.example" })).status, 404);
  });
});

test("every response has HSTS and the panel gets a fresh CSP nonce on its inline code", async () => {
  await withServer({}, async ({ base }) => {
    const health = await fetch(`${base}/health`);
    assert.match(health.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
    assert.match(health.headers.get("content-security-policy") ?? "", /default-src 'none'/);

    const load = async () => {
      const response = await fetch(`${base}/operator`, { headers: { authorization } });
      const policy = response.headers.get("content-security-policy") ?? "";
      const nonce = /script-src 'nonce-([^']+)'/.exec(policy)?.[1];
      assert.ok(nonce);
      assert.equal(policy.includes("unsafe-inline"), false);
      const html = await response.text();
      assert.ok(html.includes(`<script nonce="${nonce}">`));
      assert.ok(html.includes(`<style nonce="${nonce}">`));
      return nonce;
    };
    assert.notEqual(await load(), await load());
  });
});

test("webhook truncates long text, does not echo it and answers non-text with fixed text", async () => {
  await withServer({}, async ({ calls, json, sent }) => {
    const long = await json(webhookPath, webhook({}, { conversation: "y".repeat(MAX_MESSAGE_CHARS + 500) }));
    assert.equal(long.status, 202);
    assert.deepEqual(await long.json(), { accepted: true });
    assert.equal(calls[0]!.length, MAX_MESSAGE_CHARS);

    const audio = webhook({ Type: "media" }, { audioMessage: {} });
    assert.deepEqual(await (await json(webhookPath, audio)).json(), { accepted: true });
    await json(webhookPath, audio);
    const secondAudio = await json(webhookPath, webhook({ Type: "media" }, { audioMessage: {} }));
    assert.deepEqual(await secondAudio.json(), { accepted: true });
    assert.equal(calls.length, 1);
    assert.equal(sent.filter(({ content }) => content === UNSUPPORTED_MESSAGE_REPLY).length, 1);

    const reaction = await json(webhookPath, webhook({ Type: "reaction" }, {}));
    assert.deepEqual(await reaction.json(), { accepted: false, reason: "ignored_event" });
    assert.equal(sent.length, 2);
  });
});

test("Origin compares with Host ignoring the default port, or with PUBLIC_ORIGIN when defined", async () => {
  const request = (base: string, origin: string, host: string) => new Promise<number>((resolve, reject) => {
    const { port } = new URL(base);
    const outgoing = httpRequest({ host: "127.0.0.1", port, method: "POST", path: `/v1/businesses/${businessId}/conversations`, headers: { origin, host, authorization, "content-type": "application/json" } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    outgoing.on("error", reject);
    outgoing.end(JSON.stringify({ channel: Channel.WEB }));
  });

  await withServer({}, async ({ base }) => {
    assert.equal(await request(base, "https://app.example", "app.example"), 201);
    assert.equal(await request(base, "https://app.example", "app.example:443"), 201);
    assert.equal(await request(base, "http://app.example", "app.example:80"), 201);
    assert.equal(await request(base, "https://app.example", "app.example:8443"), 403);
    assert.equal(await request(base, "https://evil.example", "app.example"), 403);
  });
  await withServer({ publicOrigin: "https://painel.example" }, async ({ base }) => {
    assert.equal(await request(base, "https://painel.example", "interno:3000"), 201);
    assert.equal(await request(base, "https://interno:3000", "interno:3000"), 403);
    assert.equal(await request(base, "http://painel.example", "painel.example"), 403);
  });
});
