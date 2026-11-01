import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { Script } from "node:vm";
import type { Conversation, HumanHandoff } from "../../src/core/domain/entities.js";
import { Channel, ConversationStatus, HandoffReason, HandoffStatus, SenderType } from "../../src/core/domain/enums.js";
import {
  InMemoryAppointmentRepository, InMemoryBusinessProfileRepository, InMemoryConversationRepository, InMemoryCustomerRepository,
  InMemoryHumanHandoffRepository, InMemoryMessageRepository, InMemoryOpportunityRepository, InMemoryOutboundDeliveryRepository,
  InMemoryQuoteRequestRepository, InMemoryVehicleRepository,
} from "../../src/core/in-memory-repositories.js";
import { BasicBusinessOperatorAuthorizer } from "../../src/infrastructure/http/basic-business-operator-authorizer.js";
import { createBasicPlanHttpServer } from "../../src/infrastructure/http/basic-plan-http-server.js";

const at = "2026-01-01T12:00:00.000Z";
const password = "a-long-operator-password";
const authorization = `Basic ${Buffer.from(`operator:${password}`).toString("base64")}`;
const conversation: Conversation = { id: "conversation-1", businessId: "business-a", customerId: "customer-1", channel: Channel.WHATSAPP, status: ConversationStatus.WAITING_HUMAN, startedAt: at, lastMessageAt: at };
const handoff: HumanHandoff = { id: "handoff-1", businessId: "business-a", conversationId: "conversation-1", reason: HandoffReason.CUSTOMER_REQUEST, summary: "Quero uma pessoa", status: HandoffStatus.REQUESTED, requestedAt: at, createdAt: at, updatedAt: at };

async function start(options: { sendFails?: boolean; now?: () => string } = {}) {
  const humanHandoffRepository = new InMemoryHumanHandoffRepository();
  const conversationRepository = new InMemoryConversationRepository();
  const messageRepository = new InMemoryMessageRepository();
  const customerRepository = new InMemoryCustomerRepository();
  const businessProfileRepository = new InMemoryBusinessProfileRepository();
  const sent: Array<{ recipientJid: string; content: string }> = [];
  let sequence = 0;
  await humanHandoffRepository.save(handoff);
  await conversationRepository.save(conversation);
  await customerRepository.save({ id: "customer-1", businessId: "business-a", name: "Maria", primaryPhone: "5511999990000", createdAt: at, updatedAt: at });
  await messageRepository.save({ id: "message-0", businessId: "business-a", conversationId: "conversation-1", senderType: SenderType.CUSTOMER, channel: Channel.WHATSAPP, content: "Quero uma pessoa", createdAt: at });
  const sender = { sendText: async (message: { recipientJid: string; content: string }) => { if (options.sendFails) throw new Error("synthetic"); sent.push(message); } };
  const server = createBasicPlanHttpServer({
    conversationRepository, messageRepository, customerRepository, humanHandoffRepository, businessProfileRepository,
    vehicleRepository: new InMemoryVehicleRepository(),
    opportunityRepository: new InMemoryOpportunityRepository(),
    quoteRequestRepository: new InMemoryQuoteRequestRepository(),
    outboundDeliveryRepository: new InMemoryOutboundDeliveryRepository(),
    appointmentRepository: new InMemoryAppointmentRepository(),
    businessOperatorAuthorizer: new BasicBusinessOperatorAuthorizer("business-a", "operator", password),
    evolutionGoWebhookTransaction: { run: (operation) => operation() },
    evolutionGoConversationLinkRepository: {
      findByConversation: async (businessId: string, conversationId: string) => ({ businessId, instanceName: "instance", senderJid: "5511999990000@s.whatsapp.net", conversationId, createdAt: at, updatedAt: at }),
    } as never,
    channelTextSenders: { [Channel.WHATSAPP]: sender },
    operator: { businessId: "business-a", businessName: "Oficina A" },
    interpreter: { interpret: async () => { throw new Error("not used"); } },
    now: options.now ?? (() => "2026-01-01T12:30:00.000Z"),
    generateId: (prefix) => `${prefix}-${++sequence}`,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, method = "GET", body?: unknown, authorized = true) => fetch(base + path, {
    method,
    headers: { ...(authorized ? { authorization } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { call, sent, businessProfileRepository, humanHandoffRepository, conversationRepository, messageRepository, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("the profile is empty at first, saved whole, read back and refused when it carries a price", async () => {
  const harness = await start();
  try {
    const empty = await (await harness.call("/v1/businesses/business-a/profile")).json();
    assert.deepEqual(empty, { businessId: "business-a", openingHours: {}, services: [], paymentMethods: [] });

    const saved = await harness.call("/v1/businesses/business-a/profile", "PUT", {
      address: "Rua A, 1", notifyPhone: "(92) 99999-1234", openingHours: { 6: [{ open: "08:00", close: "12:00" }] },
      services: ["Troca de óleo"], paymentMethods: ["Pix"],
    });
    assert.equal(saved.status, 200);
    const read = await (await harness.call("/v1/businesses/business-a/profile")).json() as { notifyPhone: string; openingHours: Record<string, unknown>; updatedAt: string };
    assert.equal(read.notifyPhone, "5592999991234");
    assert.deepEqual(read.openingHours, { 6: [{ open: "08:00", close: "12:00" }] });
    assert.equal(read.updatedAt, "2026-01-01T12:30:00.000Z");

    const refused = await harness.call("/v1/businesses/business-a/profile", "PUT", { services: ["Troca de óleo por R$ 120"] });
    assert.equal(refused.status, 400);
    assert.match((await refused.json() as { error: string }).error, /preços/);
    assert.deepEqual((await (await harness.call("/v1/businesses/business-a/profile")).json() as { services: string[] }).services, ["Troca de óleo"]);
  } finally { await harness.close(); }
});

test("the credential of one business gets 404 on every profile and handoff route of another", async () => {
  const harness = await start();
  try {
    for (const [method, path, body] of [
      ["GET", "/v1/businesses/business-b/profile", undefined],
      ["PUT", "/v1/businesses/business-b/profile", {}],
      ["GET", "/v1/businesses/business-b/handoffs", undefined],
      ["POST", "/v1/businesses/business-b/handoffs/handoff-1/assign", {}],
      ["POST", "/v1/businesses/business-b/handoffs/handoff-1/reply", { content: "Oi" }],
      ["POST", "/v1/businesses/business-b/handoffs/handoff-1/resolve", {}],
    ] as const) {
      assert.equal((await harness.call(path, method, body)).status, 404, `${method} ${path}`);
    }
    for (const path of ["/v1/businesses/business-a/profile", "/v1/businesses/business-a/handoffs"]) {
      assert.equal((await harness.call(path, "GET", undefined, false)).status, 404, `anonymous ${path}`);
    }
    assert.deepEqual(harness.sent, []);
    assert.equal((await harness.humanHandoffRepository.findById("business-a", "handoff-1"))?.status, HandoffStatus.REQUESTED);
  } finally { await harness.close(); }
});

test("a handoff goes from the queue to a reply to the bot again over HTTP", async () => {
  const harness = await start();
  try {
    const queue = await (await harness.call("/v1/businesses/business-a/handoffs")).json() as { items: Array<{ id: string; status: string; customer: { name: string; phone: string }; summary: string; messages: unknown[] }> };
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0]?.customer.phone, "5511999990000");
    assert.equal(queue.items[0]?.summary, "Quero uma pessoa");

    assert.equal((await harness.call("/v1/businesses/business-a/handoffs/handoff-1/assign", "POST", {})).status, 200);
    const reply = await harness.call("/v1/businesses/business-a/handoffs/handoff-1/reply", "POST", { content: "Já estou indo aí." });
    assert.equal(reply.status, 200);
    assert.deepEqual(harness.sent, [{ recipientJid: "5511999990000@s.whatsapp.net", content: "Já estou indo aí." }]);
    const history = await harness.messageRepository.listByConversation("business-a", "conversation-1");
    assert.equal(history.at(-1)?.senderType, SenderType.HUMAN_AGENT);

    assert.equal((await harness.call("/v1/businesses/business-a/handoffs/handoff-1/reply", "POST", { content: "  " })).status, 400);
    assert.equal((await harness.call("/v1/businesses/business-a/handoffs/handoff-1/resolve", "POST", {})).status, 200);
    assert.equal((await harness.conversationRepository.findById("business-a", "conversation-1"))?.status, ConversationStatus.ACTIVE);
    assert.deepEqual((await (await harness.call("/v1/businesses/business-a/handoffs")).json() as { items: unknown[] }).items, []);
    assert.equal((await harness.call("/v1/businesses/business-a/handoffs/handoff-1/reply", "POST", { content: "Tarde" })).status, 409);
    assert.equal((await harness.call("/v1/businesses/business-a/handoffs/unknown/assign", "POST", {})).status, 404);
  } finally { await harness.close(); }
});

test("the customer writing into a taken conversation warns the workshop at most once every 30 minutes, with the provider resolving the number", async () => {
  let now = "2026-01-01T12:30:00.000Z";
  const harness = await start({ now: () => now });
  const customerWrites = () => harness.call("/v1/businesses/business-a/conversations/conversation-1/messages", "POST", { content: "Segredo do cliente" });
  const notices = () => harness.sent.filter(({ recipientJid }) => recipientJid === "5592999991234");
  const waitForNotices = async (count: number) => {
    const deadline = Date.now() + 2000;
    while (notices().length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(notices().length, count);
  };
  try {
    await harness.businessProfileRepository.save({ businessId: "business-a", notifyPhone: "5592999991234", openingHours: {}, services: [], paymentMethods: [], updatedAt: at });

    assert.equal((await customerWrites()).status, 200);
    await waitForNotices(0);

    assert.equal((await harness.call("/v1/businesses/business-a/handoffs/handoff-1/assign", "POST", {})).status, 200);
    assert.equal((await customerWrites()).status, 200);
    assert.equal((await customerWrites()).status, 200);
    await waitForNotices(1);
    assert.deepEqual(notices()[0], { recipientJid: "5592999991234", content: "Atendente 24h: um cliente em atendimento humano escreveu de novo. Abra o painel para responder.", formatJid: true });

    now = "2026-01-01T12:59:59.000Z";
    assert.equal((await customerWrites()).status, 200);
    await waitForNotices(1);

    now = "2026-01-01T13:00:00.000Z";
    assert.equal((await customerWrites()).status, 200);
    await waitForNotices(2);
  } finally { await harness.close(); }
});

test("a reply after the handoff went back to the bot tells the operator to answer on WhatsApp", async () => {
  const harness = await start();
  try {
    await harness.humanHandoffRepository.save({ ...handoff, status: HandoffStatus.RESOLVED, resolvedAt: at });
    const reply = await harness.call("/v1/businesses/business-a/handoffs/handoff-1/reply", "POST", { content: "Tarde" });
    assert.equal(reply.status, 409);
    assert.match((await reply.json() as { error: string }).error, /responda pelo WhatsApp/);
  } finally { await harness.close(); }
});

test("a send failure answers 503 with a clear message and writes nothing", async () => {
  const harness = await start({ sendFails: true });
  try {
    const reply = await harness.call("/v1/businesses/business-a/handoffs/handoff-1/reply", "POST", { content: "Texto importante" });
    assert.equal(reply.status, 503);
    assert.match((await reply.json() as { error: string }).error, /Não foi possível enviar/);
    assert.deepEqual((await harness.messageRepository.listByConversation("business-a", "conversation-1")).map(({ content }) => content), ["Quero uma pessoa"]);
    assert.equal((await harness.humanHandoffRepository.findById("business-a", "handoff-1"))?.status, HandoffStatus.REQUESTED);
  } finally { await harness.close(); }
});

test("the panel has both new sections and keeps building the DOM with textContent only", async () => {
  const harness = await start();
  try {
    const response = await harness.call("/operator");
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Atendimento humano/);
    assert.match(html, /Dados da oficina/);
    for (const forbidden of [/innerHTML/, /\bon[a-z]+\s*=\s*["']/i, /\sstyle\s*=/i]) assert.doesNotMatch(html, forbidden);
    const nonce = /<script nonce="([^"]+)">/.exec(html)?.[1];
    assert.ok(nonce);
    assert.ok((response.headers.get("content-security-policy") ?? "").includes(`script-src 'nonce-${nonce}'`));
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    assert.doesNotThrow(() => new Script(script));
  } finally { await harness.close(); }
});
