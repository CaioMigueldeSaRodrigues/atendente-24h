import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createBasicPlanPostgresRuntime } from "../../src/app/basic-plan-postgres-runtime.js";
import { BusinessType, ConversationStatus, HandoffStatus, Intent, QuoteRequestStatus, SenderType } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import type { BasicPlanOperationalEvent } from "../../src/infrastructure/http/basic-plan-http-server.js";
import { LLM_FAILURE_REPLY } from "../../src/core/response-policy.js";
import { PostgresDatabase, type PostgresEnvironment } from "../../src/infrastructure/postgres/postgres-database.js";
import { postgresTestConfig, postgresTestEnabled } from "../postgres-test-environment.js";

const config: PostgresEnvironment = postgresTestConfig();
const enabled = postgresTestEnabled();
const businessId = "fase2-business";
const instanceName = "fase2-instance";
const authorization = "Basic fase2-operator";
const webhookPath = "/v1/channels/whatsapp/evolution-go/webhook";
const base: AIInterpretation = {
  intent: Intent.GENERAL_INFORMATION,
  extractedCustomerData: {},
  extractedVehicleData: {},
  missingData: [],
  suggestedNextAction: { type: "NONE", description: "Nenhuma ação" },
  requiresHuman: false,
  proposedResponse: "Resposta sintética",
};

type Options = {
  interpret?: (content: string) => Promise<AIInterpretation>;
  sendText?: (message: { recipientJid: string; content: string }) => Promise<void>;
  now?: () => string;
};

async function withRuntime(options: Options, run: (context: {
  runtime: Awaited<ReturnType<typeof createBasicPlanPostgresRuntime>>;
  sent: Array<{ recipientJid: string; content: string }>;
  interpreted: string[];
  events: BasicPlanOperationalEvent[];
  api: (path: string, method?: string, body?: unknown) => Promise<Response>;
  webhook: (externalMessageId: string, senderJid: string, content?: string, pushName?: string) => Promise<Response>;
}) => Promise<void>) {
  const schema = `fase2_${randomUUID().replaceAll("-", "")}`;
  const admin = new PostgresDatabase(config, { allowInsecureLocal: true });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const sent: Array<{ recipientJid: string; content: string }> = [];
  const interpreted: string[] = [];
  const events: BasicPlanOperationalEvent[] = [];
  const now = options.now ?? (() => new Date().toISOString());
  const runtime = await createBasicPlanPostgresRuntime({
    postgres: config,
    postgresSearchPathForTests: schema,
    allowInsecureLocalForTests: true,
    now,
    business: { businessId, businessName: "Fase 2", businessType: BusinessType.OTHER, timezone: "America/Manaus" },
    businessOperatorAuthorizer: { isAuthorized: async (input) => input.businessId === businessId && input.credential === authorization },
    evolutionGoWebhookCredential: { businessId, instanceName, instanceToken: "fase2-token" },
    evolutionGoTextSender: { sendText: async (message) => { await options.sendText?.(message); sent.push(message); } },
    operationalLog: (event) => events.push(event),
    interpreter: {
      interpret: async ({ content }) => {
        interpreted.push(content);
        return options.interpret ? options.interpret(content) : base;
      },
    },
  });
  await new Promise<void>((resolve) => { runtime.server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const api = (path: string, method = "GET", body?: unknown) => fetch(`${origin}/v1/businesses/${businessId}${path}`, {
    method,
    headers: { authorization, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const webhook = (externalMessageId: string, senderJid: string, content = "Olá", pushName?: string) => fetch(origin + webhookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: "Message", instanceName, instanceToken: "fase2-token",
      data: { Info: { ID: externalMessageId, Type: "text", Sender: senderJid, Timestamp: now(), IsFromMe: false, IsGroup: false, ...(pushName ? { PushName: pushName } : {}) }, Message: { conversation: content } },
    }),
  });
  try {
    await run({ runtime, sent, interpreted, events, api, webhook });
  } finally {
    await runtime.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.close();
  }
}

async function waitUntil(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const humanRequest: AIInterpretation = { ...base, intent: Intent.HUMAN_REQUEST, requiresHuman: true };

test("a customer who asks for a person waits in silence for the operator, who answers and gives the bot back", { skip: !enabled }, async () => {
  const jid = "5511900000010@s.whatsapp.net";
  await withRuntime({ interpret: async (content) => content === "Quero atendente" ? humanRequest : base }, async ({ runtime, sent, interpreted, events, api, webhook }) => {
    const profile = await api("/profile", "PUT", { notifyPhone: "(92) 99999-1234", services: ["Troca de óleo"] });
    assert.equal(profile.status, 200);

    assert.equal((await webhook("human-1", jid, "Quero atendente", "Maria Push")).status, 202);
    assert.ok(sent.some(({ recipientJid }) => recipientJid === jid));
    await waitUntil(() => sent.some(({ recipientJid }) => recipientJid === "5592999991234"), "the workshop was not told");
    const notice = sent.find(({ recipientJid }) => recipientJid === "5592999991234")!;
    assert.equal(notice.content.includes("Quero atendente"), false);
    assert.equal(notice.content.includes("Maria"), false);

    const customer = await runtime.database.query("SELECT name,primary_phone FROM customers");
    assert.deepEqual(customer.rows, [{ name: "Maria Push", primary_phone: "5511900000010" }]);

    // The next messages are stored but neither interpreted nor answered, and a retry stores nothing twice.
    const before = sent.length;
    assert.equal((await webhook("human-2", jid, "Alguém aí?")).status, 202);
    assert.equal((await webhook("human-2", jid, "Alguém aí?")).status, 202);
    assert.deepEqual(interpreted, ["Quero atendente"]);
    assert.equal(sent.length, before);
    assert.deepEqual((await runtime.database.query("SELECT sender_type,count(*)::int AS n FROM messages GROUP BY sender_type ORDER BY sender_type")).rows, [{ sender_type: "ASSISTANT", n: 1 }, { sender_type: "CUSTOMER", n: 2 }]);
    assert.equal((await runtime.database.query<{ n: number }>("SELECT count(*)::int AS n FROM human_handoffs")).rows[0]!.n, 1);
    assert.deepEqual((await runtime.database.query("SELECT status FROM evolution_go_webhook_receipts ORDER BY external_message_id")).rows, [{ status: "sent" }, { status: "sent" }]);
    assert.equal((await runtime.database.query<{ n: number }>("SELECT count(*)::int AS n FROM evolution_go_webhook_claims")).rows[0]!.n, 0);

    const queue = await (await api("/handoffs")).json() as { items: Array<{ id: string; customer: { name: string; phone: string }; summary: string; messages: Array<{ content: string }> }> };
    assert.equal(queue.items.length, 1);
    const handoff = queue.items[0]!;
    assert.deepEqual(handoff.customer, { name: "Maria Push", phone: "5511900000010" });
    // The summary is taken when the handoff opens; what the customer says afterwards is in the messages.
    assert.equal(handoff.summary, "Quero atendente");
    assert.deepEqual(handoff.messages.map(({ content }) => content), ["Quero atendente", "Vou encaminhar sua solicitação para a equipe responsável.", "Alguém aí?"]);

    assert.equal((await api(`/handoffs/${handoff.id}/assign`, "POST", {})).status, 200);
    assert.equal((await api(`/handoffs/${handoff.id}/reply`, "POST", { content: "Oi Maria, já te atendo." })).status, 200);
    assert.deepEqual(sent.at(-1), { recipientJid: jid, content: "Oi Maria, já te atendo." });
    assert.equal((await runtime.database.query<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE sender_type=$1", [SenderType.HUMAN_AGENT])).rows[0]!.n, 1);

    assert.equal((await webhook("human-3", jid, "Obrigada")).status, 202);
    assert.deepEqual(interpreted, ["Quero atendente"]);
    await waitUntil(() => sent.filter(({ recipientJid }) => recipientJid === "5592999991234").length === 2, "the workshop was not told about the taken conversation");
    assert.equal(sent.at(-1)?.content.includes("Obrigada"), false);

    assert.equal((await api(`/handoffs/${handoff.id}/resolve`, "POST", {})).status, 200);
    assert.deepEqual((await runtime.database.query("SELECT status FROM conversations")).rows, [{ status: ConversationStatus.ACTIVE }]);
    assert.deepEqual((await runtime.database.query("SELECT status FROM human_handoffs")).rows, [{ status: HandoffStatus.RESOLVED }]);
    assert.equal((await webhook("human-4", jid, "E o carro?")).status, 202);
    assert.deepEqual(interpreted, ["Quero atendente", "E o carro?"]);
    assert.equal(sent.at(-1)?.content, "Resposta sintética");
    assert.equal(events.includes("Handoff notice failed"), false);
  });
});

test("a failure to warn the workshop never blocks the customer and logs no customer content", { skip: !enabled }, async () => {
  const jid = "5511900000011@s.whatsapp.net";
  await withRuntime({
    interpret: async () => humanRequest,
    sendText: async ({ recipientJid }) => { if (recipientJid.startsWith("5592")) throw new Error("synthetic notice failure with Segredo do cliente"); },
  }, async ({ sent, events, api, webhook }) => {
    assert.equal((await api("/profile", "PUT", { notifyPhone: "92999991234" })).status, 200);
    assert.equal((await webhook("notice-fails", jid, "Segredo do cliente")).status, 202);
    assert.equal(sent.at(-1)?.recipientJid, jid);
    await waitUntil(() => events.includes("Handoff notice failed"), "the failed notice was not logged");
    assert.equal(JSON.stringify(events).includes("Segredo"), false);
  });
});

test("a fixed reply of a failed LLM still goes out, and stops only once a person assigns the handoff", { skip: !enabled }, async () => {
  let now = "2026-07-01T00:00:00.000Z";
  let fail = true;
  await withRuntime({
    now: () => now,
    interpret: async () => { throw new Error("synthetic LLM outage"); },
    sendText: async () => { if (fail) throw new Error("synthetic sender failure"); },
  }, async ({ runtime, sent, api, webhook }) => {
    assert.equal((await webhook("down-1", "5511900000012@s.whatsapp.net")).status, 503);
    assert.equal((await webhook("down-2", "5511900000013@s.whatsapp.net")).status, 503);
    assert.deepEqual((await runtime.database.query("SELECT DISTINCT status FROM conversations")).rows, [{ status: ConversationStatus.WAITING_HUMAN }]);
    const second = (await runtime.database.query<{ id: string }>("SELECT h.id FROM human_handoffs h JOIN evolution_go_webhook_receipts r ON r.conversation_id=h.conversation_id WHERE r.external_message_id='down-2'")).rows[0]!.id;
    assert.equal((await api(`/handoffs/${second}/assign`, "POST", {})).status, 200);

    fail = false;
    now = "2026-07-01T00:03:00.000Z";
    await runtime.outboundWorker!.runOnce();

    assert.deepEqual(sent.map(({ recipientJid, content }) => [recipientJid, content]), [["5511900000012@s.whatsapp.net", LLM_FAILURE_REPLY]]);
  });
});

test("every cycle closes idle conversations, but not those with a person or with work owed, and the next message opens a new one", { skip: !enabled }, async () => {
  let now = "2026-08-01T00:00:00.000Z";
  await withRuntime({ now: () => now }, async ({ runtime, webhook }) => {
    const database = runtime.database;
    const jids = ["5511900000020", "5511900000021", "5511900000022", "5511900000023"].map((phone) => `${phone}@s.whatsapp.net`);
    for (const [index, jid] of jids.entries()) assert.equal((await webhook(`idle-${index}`, jid, "Oi", "Cliente")).status, 202);
    const conversationOf = async (jid: string) => (await database.query<{ id: string }>("SELECT conversation_id AS id FROM evolution_go_conversation_links WHERE sender_jid=$1", [jid])).rows[0]!.id;
    const [idle, withPerson, withQuote, recent] = await Promise.all(jids.map(conversationOf)) as [string, string, string, string];
    await database.query("UPDATE conversations SET last_message_at='2026-07-30T00:00:00.000Z' WHERE id = ANY($1)", [[idle, withPerson, withQuote]]);
    await database.query("UPDATE conversations SET status=$1 WHERE id=$2", [ConversationStatus.WAITING_HUMAN, withPerson]);
    await database.query("INSERT INTO opportunities(id,business_id,conversation_id,status,created_at,updated_at) VALUES('opp-owed',$1,$2,'WAITING_BUSINESS',$3,$3)", [businessId, withQuote, now]);
    await database.query("INSERT INTO quote_requests(id,business_id,opportunity_id,conversation_id,request_description,status,requested_at,created_at,updated_at) VALUES('quote-owed',$1,'opp-owed',$2,'Pedido',$3,$4,$4,$4)", [businessId, withQuote, QuoteRequestStatus.WAITING_BUSINESS, now]);
    await database.query("INSERT INTO automotive_businesses(id,name,business_type,timezone,active,created_at,updated_at) VALUES('fase2-other','Outra','OTHER','UTC',true,$1,$1)", [now]);
    await database.query("INSERT INTO conversations(id,business_id,channel,status,started_at,last_message_at) VALUES('conversation-other','fase2-other','WHATSAPP','ACTIVE','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z')");

    now = "2026-08-01T00:10:00.000Z";
    await runtime.outboundWorker!.runOnce();

    const statuses = Object.fromEntries((await database.query<{ id: string; status: string }>("SELECT id,status FROM conversations")).rows.map(({ id, status }) => [id, status]));
    assert.equal(statuses[idle], ConversationStatus.CLOSED);
    assert.equal(statuses[withPerson], ConversationStatus.WAITING_HUMAN);
    assert.equal(statuses[withQuote], ConversationStatus.ACTIVE);
    assert.equal(statuses[recent], ConversationStatus.ACTIVE);
    assert.equal(statuses["conversation-other"], ConversationStatus.ACTIVE);
    assert.notEqual((await database.query<{ closed_at: string | null }>("SELECT closed_at FROM conversations WHERE id=$1", [idle])).rows[0]!.closed_at, null);

    assert.equal((await webhook("idle-again", jids[0]!, "Voltei")).status, 202);
    const reopened = await conversationOf(jids[0]!);
    assert.notEqual(reopened, idle);
    const customers = await database.query<{ id: string }>("SELECT customer_id AS id FROM conversations WHERE id = ANY($1)", [[idle, reopened]]);
    assert.equal(new Set(customers.rows.map(({ id }) => id)).size, 1);
  });
});
