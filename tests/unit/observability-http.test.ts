import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { InMemoryAppointmentRepository, InMemoryConversationRepository, InMemoryCustomerRepository, InMemoryHumanHandoffRepository, InMemoryMessageRepository, InMemoryOpportunityRepository, InMemoryOutboundDeliveryRepository, InMemoryQuoteRequestRepository, InMemoryVehicleRepository } from "../../src/core/in-memory-repositories.js";
import { Channel, ConversationStatus } from "../../src/core/domain/enums.js";
import { BasicBusinessOperatorAuthorizer } from "../../src/infrastructure/http/basic-business-operator-authorizer.js";
import { createBasicPlanHttpServer } from "../../src/infrastructure/http/basic-plan-http-server.js";
import { createLogger } from "../../src/infrastructure/logger.js";

const password = "a-long-operator-password";
const authorization = `Basic ${Buffer.from(`operator:${password}`).toString("base64")}`;
const secretText = "Meu CPF é 123.456.789-09 e o telefone 5592999990000 SEGREDO-DO-CLIENTE";

async function start(options: { readiness?: () => Promise<void>; failMessages?: boolean; privacyContact?: string } = {}) {
  const lines: string[] = [];
  const messageRepository = new InMemoryMessageRepository();
  const conversationRepository = new InMemoryConversationRepository();
  await conversationRepository.save({ id: "conversation-secret-9", businessId: "business-a", channel: Channel.WEB, status: ConversationStatus.ACTIVE, startedAt: "2026-01-01T00:00:00.000Z", lastMessageAt: "2026-01-01T00:00:00.000Z" });
  if (options.failMessages) {
    messageRepository.listByConversation = async () => { throw Object.assign(new Error(`driver said: ${secretText}`), { code: "XX000" }); };
  }
  const server = createBasicPlanHttpServer({
    conversationRepository, messageRepository, customerRepository: new InMemoryCustomerRepository(),
    humanHandoffRepository: new InMemoryHumanHandoffRepository(), vehicleRepository: new InMemoryVehicleRepository(),
    opportunityRepository: new InMemoryOpportunityRepository(), quoteRequestRepository: new InMemoryQuoteRequestRepository(),
    outboundDeliveryRepository: new InMemoryOutboundDeliveryRepository(), appointmentRepository: new InMemoryAppointmentRepository(),
    businessOperatorAuthorizer: new BasicBusinessOperatorAuthorizer("business-a", "operator", password),
    evolutionGoWebhookTransaction: { run: (operation) => operation() },
    operator: { businessId: "business-a", businessName: "Oficina <A>" },
    interpreter: { interpret: async () => { throw new Error("not used"); } },
    logger: createLogger((line) => lines.push(line), () => "2026-01-01T00:00:00.000Z"),
    ...(options.readiness ? { readiness: options.readiness } : {}),
    ...(options.privacyContact ? { privacyContact: options.privacyContact } : {}),
    now: () => "2026-01-01T00:00:00.000Z",
    generateId: (prefix) => `${prefix}-1`,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, lines, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("every response carries its own X-Request-Id, including errors and refusals", async () => {
  const harness = await start();
  try {
    const ids = new Set<string>();
    for (const [path, status] of [["/health", 200], ["/ready", 200], ["/nao-existe", 404], ["/v1/businesses/business-a/handoffs", 404]] as const) {
      const response = await fetch(harness.base + path);
      assert.equal(response.status, status, path);
      ids.add(response.headers.get("x-request-id") ?? "");
    }
    assert.equal(ids.size, 4);
    for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/);
  } finally { await harness.close(); }
});

test("a forced 500 logs the request id, method, route without ids, error name and code, and never the message or its content", async () => {
  const harness = await start({ failMessages: true });
  try {
    const response = await fetch(`${harness.base}/v1/businesses/business-a/conversations/conversation-secret-9/messages?token=abc`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ content: secretText }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Internal server error" });
    assert.equal(harness.lines.length, 1);
    assert.deepEqual(JSON.parse(harness.lines[0]!), {
      level: "error", event: "HTTP 500", time: "2026-01-01T00:00:00.000Z",
      requestId: response.headers.get("x-request-id"), method: "POST",
      route: "/v1/businesses/:id/conversations/:id/messages", errorName: "Error", errorCode: "XX000",
    });
    for (const forbidden of ["SEGREDO", "123.456.789", "5592999990000", "driver said", "conversation-secret", "token=abc", "business-a"]) {
      assert.equal(harness.lines[0]!.includes(forbidden), false, forbidden);
    }
  } finally { await harness.close(); }
});

test("a refusal or a client error is not an incident: nothing is logged for 4xx", async () => {
  const harness = await start();
  try {
    assert.equal((await fetch(`${harness.base}/v1/businesses/business-a/handoffs`)).status, 404);
    assert.deepEqual(harness.lines, []);
  } finally { await harness.close(); }
});

test("/ready answers 200 or 503 with no detail, and /health stays a plain liveness check", async () => {
  let up = true;
  const harness = await start({ readiness: async () => { if (!up) throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"), { code: "ECONNREFUSED" }); } });
  try {
    const ready = await fetch(`${harness.base}/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: "ok" });

    up = false;
    const down = await fetch(`${harness.base}/ready`);
    assert.equal(down.status, 503);
    assert.equal(await down.text(), JSON.stringify({ status: "unavailable" }));
    assert.equal((await fetch(`${harness.base}/health`)).status, 200);
    assert.equal(harness.lines.length, 1);
    assert.equal(JSON.parse(harness.lines[0]!).errorCode, "ECONNREFUSED");
    assert.equal(/10\.0\.0\.5|hunter2/.test(harness.lines[0]!), false);
  } finally { await harness.close(); }
});

test("/privacidade is public, has no script, says it is a draft, names the contact and escapes what it prints", async () => {
  const harness = await start({ privacyContact: "privacidade@oficina.example <script>alert(1)</script>" });
  try {
    const response = await fetch(`${harness.base}/privacidade`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html; charset=utf-8/);
    assert.equal(response.headers.get("content-security-policy")?.includes("script-src"), false);
    assert.match(html, /Minuta sujeita a revisão jurídica/);
    for (const topic of [/Dados que coletamos/, /Para que usamos/, /provedor de inteligência artificial/, /WhatsApp/, /Por quanto tempo/, /Seus direitos/, /privacidade@oficina\.example/]) assert.match(html, topic);
    assert.doesNotMatch(html, /<script|onerror=|javascript:/i);
    assert.match(html, /Oficina &#60;A&#62;|a oficina/);
    assert.equal(html.includes("Oficina <A>"), false);
  } finally { await harness.close(); }
});
