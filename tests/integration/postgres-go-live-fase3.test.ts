import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createBasicPlanPostgresRuntime } from "../../src/app/basic-plan-postgres-runtime.js";
import { BusinessType, ConversationStatus, HandoffStatus, Intent } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { STALE_HANDOFF_REPLY } from "../../src/core/human-handoff-service.js";
import { PRIVACY_NOTICE_PREFIX } from "../../src/core/process-message.js";
import { OUTBOUND_MAX_ATTEMPTS } from "../../src/core/outbound-worker.js";
import { HANDOFF_REPLY, LLM_FAILURE_REPLY } from "../../src/core/response-policy.js";
import { PostgresDatabase, type PostgresEnvironment } from "../../src/infrastructure/postgres/postgres-database.js";
import { MIGRATIONS, applyPostgresMigrations, findMigrationsDirectory } from "../../src/infrastructure/postgres/postgres-migrations.js";
import { postgresTestConfig, postgresTestEnabled } from "../postgres-test-environment.js";

const config: PostgresEnvironment = postgresTestConfig();
const enabled = postgresTestEnabled();
const businessId = "fase3-business";
const instanceName = "fase3-instance";
const instanceToken = "fase3-token";
const authorization = "Basic fase3-operator";
const webhookPath = "/v1/channels/whatsapp/evolution-go/webhook";
const base: AIInterpretation = {
  intent: Intent.GENERAL_INFORMATION, extractedCustomerData: {}, extractedVehicleData: {}, missingData: [],
  suggestedNextAction: { type: "NONE", description: "Nenhuma ação" }, requiresHuman: false, proposedResponse: "Resposta sintética",
};
const humanRequest: AIInterpretation = { ...base, intent: Intent.HUMAN_REQUEST, requiresHuman: true };

type Options = { interpret?: (content: string) => Promise<AIInterpretation>; now?: () => string; publicOrigin?: string; sendFails?: boolean; events?: string[] };

async function withRuntime(options: Options, run: (context: {
  runtime: Awaited<ReturnType<typeof createBasicPlanPostgresRuntime>>;
  sent: Array<{ recipientJid: string; content: string }>;
  api: (path: string, method?: string, body?: unknown) => Promise<Response>;
  webhook: (externalMessageId: string, senderJid: string, content?: string, pushName?: string, chatJid?: string) => Promise<Response>;
}) => Promise<void>) {
  const schema = `fase3_${randomUUID().replaceAll("-", "")}`;
  const admin = new PostgresDatabase(config, { allowInsecureLocal: true });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const sent: Array<{ recipientJid: string; content: string }> = [];
  const now = options.now ?? (() => new Date().toISOString());
  const runtime = await createBasicPlanPostgresRuntime({
    postgres: config,
    postgresSearchPathForTests: schema,
    allowInsecureLocalForTests: true,
    now,
    ...(options.publicOrigin === undefined ? {} : { publicOrigin: options.publicOrigin }),
    business: { businessId, businessName: "Auto Fase 3", businessType: BusinessType.OTHER, timezone: "UTC" },
    businessOperatorAuthorizer: { isAuthorized: async (input) => input.businessId === businessId && input.credential === authorization },
    evolutionGoWebhookCredential: { businessId, instanceName, instanceToken },
    evolutionGoTextSender: { sendText: async (message) => { if (options.sendFails) throw new Error("synthetic sender failure"); sent.push(message); } },
    operationalLog: (event) => options.events?.push(event),
    interpreter: { interpret: async ({ content }) => options.interpret ? options.interpret(content) : base },
  });
  await new Promise<void>((resolve) => { runtime.server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const api = (path: string, method = "GET", body?: unknown) => fetch(`${origin}/v1/businesses/${businessId}${path}`, {
    method,
    headers: { authorization, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const webhook = (externalMessageId: string, senderJid: string, content = "Olá", pushName?: string, chatJid?: string) => fetch(origin + webhookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: "Message", instanceName, instanceToken,
      data: { Info: { ID: externalMessageId, Type: "text", Sender: senderJid, ...(chatJid ? { Chat: chatJid } : {}), Timestamp: now(), IsFromMe: false, IsGroup: false, ...(pushName ? { PushName: pushName } : {}) }, Message: { conversation: content } },
    }),
  });
  try {
    await run({ runtime, sent, api, webhook });
  } finally {
    await runtime.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.close();
  }
}

async function waitUntil(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a handoff nobody takes for 12 hours goes back to the bot and the customer is asked once to repeat", { skip: !enabled }, async () => {
  let now = "2026-09-01T12:00:00.000Z";
  const jid = "5511900000040@s.whatsapp.net";
  await withRuntime({ now: () => now, interpret: async (content) => content === "Quero atendente" ? humanRequest : base }, async ({ runtime, sent, webhook }) => {
    assert.equal((await webhook("stale-1", jid, "Quero atendente")).status, 202);
    const before = sent.length;

    now = "2026-09-02T00:00:00.000Z";
    await runtime.outboundWorker!.runOnce();
    assert.equal(sent.length, before, "11 hours is not enough");

    now = "2026-09-02T00:30:00.000Z";
    await runtime.outboundWorker!.runOnce();
    await runtime.outboundWorker!.runOnce();
    assert.deepEqual(sent.slice(before), [{ recipientJid: jid, content: STALE_HANDOFF_REPLY }]);
    assert.deepEqual((await runtime.database.query("SELECT status FROM human_handoffs")).rows, [{ status: HandoffStatus.RESOLVED }]);
    assert.deepEqual((await runtime.database.query("SELECT status FROM conversations")).rows, [{ status: ConversationStatus.ACTIVE }]);
    assert.equal((await runtime.database.query<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE content=$1", [STALE_HANDOFF_REPLY])).rows[0]!.n, 1);

    assert.equal((await webhook("stale-2", jid, "Preciso de freio")).status, 202);
    assert.equal(sent.at(-1)?.content, "Resposta sintética");
  });
});

test("a handoff a person took and left silent for 24 hours goes back to the bot; a human message restarts the clock", { skip: !enabled }, async () => {
  let now = "2026-09-01T12:00:00.000Z";
  const jid = "5511900000043@s.whatsapp.net";
  await withRuntime({ now: () => now, interpret: async (content) => content === "Quero atendente" ? humanRequest : base }, async ({ runtime, sent, api, webhook }) => {
    assert.equal((await webhook("taken-1", jid, "Quero atendente")).status, 202);
    const [{ id }] = (await (await api("/handoffs")).json() as { items: [{ id: string }] }).items;
    assert.equal((await api(`/handoffs/${id}/assign`, "POST", {})).status, 200);
    now = "2026-09-02T00:00:00.000Z";
    assert.equal((await api(`/handoffs/${id}/reply`, "POST", { content: "Já vejo" })).status, 200);
    const before = sent.length;

    now = "2026-09-02T23:59:00.000Z";
    await runtime.outboundWorker!.runOnce();
    assert.equal(sent.length, before, "the 24 hours count from the last human message");

    now = "2026-09-03T00:01:00.000Z";
    await runtime.outboundWorker!.runOnce();
    assert.deepEqual(sent.slice(before), [{ recipientJid: jid, content: STALE_HANDOFF_REPLY }]);
    assert.deepEqual((await runtime.database.query("SELECT status FROM human_handoffs")).rows, [{ status: HandoffStatus.RESOLVED }]);
    assert.deepEqual((await runtime.database.query("SELECT status FROM conversations")).rows, [{ status: ConversationStatus.ACTIVE }]);
  });
});

test("the price answered days later still finds its conversation: an idle one stays open for 7 days after the quote", { skip: !enabled }, async () => {
  let now = "2026-09-01T12:00:00.000Z";
  const jid = "5511900000044@s.whatsapp.net";
  await withRuntime({ now: () => now }, async ({ runtime, webhook }) => {
    assert.equal((await webhook("quote-idle", jid, "Olá")).status, 202);
    const { rows: [conversation] } = await runtime.database.query<{ id: string }>("SELECT id FROM conversations");
    const at = "2026-09-01T12:00:00.000Z";
    await runtime.database.query("INSERT INTO opportunities(id,business_id,conversation_id,request_description,status,created_at,updated_at) VALUES('opportunity-idle',$1,$2,'Freio','WAITING_CUSTOMER',$3,$3)", [businessId, conversation!.id, at]);
    await runtime.database.query("INSERT INTO quote_requests(id,business_id,opportunity_id,conversation_id,request_description,status,requested_at,responded_at,authorized_price_amount_cents,authorized_price_currency,created_at,updated_at) VALUES('quote-idle',$1,'opportunity-idle',$2,'Freio','RESPONDED',$3,$3,28200,'BRL',$3,$3)", [businessId, conversation!.id, at]);
    await runtime.database.query("INSERT INTO outbound_deliveries(id,business_id,quote_request_id,conversation_id,channel,status,attempts,created_at,updated_at) VALUES('delivery-idle',$1,'quote-idle',$2,'WHATSAPP','DELIVERED',1,$3,$3)", [businessId, conversation!.id, at]);
    const status = async () => (await runtime.database.query("SELECT status FROM conversations")).rows;

    now = "2026-09-08T11:59:59.000Z";
    await runtime.outboundWorker!.runOnce();
    assert.deepEqual(await status(), [{ status: ConversationStatus.ACTIVE }]);

    now = "2026-09-08T12:00:01.000Z";
    await runtime.outboundWorker!.runOnce();
    assert.deepEqual(await status(), [{ status: ConversationStatus.CLOSED }]);
  });
});

test("a delivered price answered by any message reaches a person through the real delivery table", { skip: !enabled }, async () => {
  const jid = "5511900000045@s.whatsapp.net";
  await withRuntime({}, async ({ runtime, sent, api, webhook }) => {
    assert.equal((await webhook("answer-1", jid, "Olá")).status, 202);
    const { rows: [conversation] } = await runtime.database.query<{ id: string }>("SELECT id FROM conversations");
    const at = new Date().toISOString();
    await runtime.database.query("INSERT INTO opportunities(id,business_id,conversation_id,request_description,status,created_at,updated_at) VALUES('opportunity-a',$1,$2,'Freio','WAITING_CUSTOMER',$3,$3)", [businessId, conversation!.id, at]);
    await runtime.database.query("INSERT INTO quote_requests(id,business_id,opportunity_id,conversation_id,request_description,status,requested_at,responded_at,authorized_price_amount_cents,authorized_price_currency,created_at,updated_at) VALUES('quote-a',$1,'opportunity-a',$2,'Freio','RESPONDED',$3,$3,28200,'BRL',$3,$3)", [businessId, conversation!.id, at]);
    await runtime.database.query("INSERT INTO outbound_deliveries(id,business_id,quote_request_id,conversation_id,channel,status,attempts,created_at,updated_at) VALUES('delivery-a',$1,'quote-a',$2,'WHATSAPP','DELIVERED',1,$3,$3)", [businessId, conversation!.id, at]);

    assert.equal((await webhook("answer-2", jid, "Pode ser")).status, 202);

    assert.equal(sent.at(-1)?.content, HANDOFF_REPLY);
    assert.deepEqual((await runtime.database.query("SELECT status FROM conversations")).rows, [{ status: ConversationStatus.WAITING_HUMAN }]);
    assert.equal((await runtime.database.query<{ n: number }>("SELECT count(*)::int AS n FROM human_handoffs")).rows[0]!.n, 1);

    const [{ id }] = (await (await api("/handoffs")).json() as { items: [{ id: string }] }).items;
    assert.equal((await api(`/handoffs/${id}/resolve`, "POST", {})).status, 200);
    assert.equal((await webhook("answer-3", jid, "Obrigado")).status, 202);

    assert.equal(sent.at(-1)?.content, "Resposta sintética");
    assert.deepEqual((await runtime.database.query("SELECT status FROM conversations")).rows, [{ status: ConversationStatus.ACTIVE }]);
    assert.deepEqual((await runtime.database.query("SELECT status FROM human_handoffs")).rows, [{ status: HandoffStatus.RESOLVED }]);
  });
});

test("the customer is the JID of the chat, so a sender with a device keeps one phone and one conversation", { skip: !enabled }, async () => {
  const chat = "5511900000046@s.whatsapp.net";
  await withRuntime({}, async ({ runtime, sent, webhook }) => {
    assert.equal((await webhook("device-1", "5511900000046:12@s.whatsapp.net", "Olá", undefined, chat)).status, 202);
    assert.equal((await webhook("device-2", "5511900000046:3@s.whatsapp.net", "Oi", undefined, chat)).status, 202);
    assert.deepEqual(sent.map(({ recipientJid }) => recipientJid), [chat, chat]);
    assert.deepEqual((await runtime.database.query("SELECT primary_phone FROM customers")).rows, [{ primary_phone: "5511900000046" }]);
    assert.equal((await runtime.database.query<{ n: number }>("SELECT count(*)::int AS n FROM conversations")).rows[0]!.n, 1);
  });
});

test("a reply that exhausts its sends leaves a handoff and the send failed event, without the phone or the text", { skip: !enabled }, async () => {
  let now = "2026-09-01T12:00:00.000Z";
  const jid = "5511900000047@s.whatsapp.net";
  const events: string[] = [];
  await withRuntime({ now: () => now, sendFails: true, events }, async ({ runtime, webhook }) => {
    assert.equal((await webhook("exhaust-1", jid, "Segredo")).status, 503);
    assert.equal(events.includes("Evolution send failed"), true);
    for (let attempt = 1; attempt <= OUTBOUND_MAX_ATTEMPTS; attempt += 1) {
      now = new Date(Date.parse(now) + 3 * 60 * 60 * 1000).toISOString();
      await runtime.outboundWorker!.runOnce();
    }
    assert.deepEqual((await runtime.database.query("SELECT reason FROM human_handoffs")).rows, [{ reason: "INTEGRATION_FAILURE" }]);
    assert.deepEqual((await runtime.database.query("SELECT status FROM conversations")).rows, [{ status: ConversationStatus.WAITING_HUMAN }]);
    assert.equal(JSON.stringify(events).includes("Segredo"), false);
    assert.equal(JSON.stringify(events).includes("5511900000047"), false);
  });
});

test("the worker that recovers a message after an LLM crash also warns the workshop about the AI_FAILURE handoff", { skip: !enabled }, async () => {
  let now = "2026-04-01T00:00:00.000Z";
  const senderJid = "5511900000041@s.whatsapp.net";
  let crash!: () => void;
  const crashed = new Promise<void>((resolve) => { crash = resolve; });
  let llmReached!: () => void;
  const reachedLlm = new Promise<void>((resolve) => { llmReached = resolve; });
  await withRuntime({ now: () => now, interpret: async () => { llmReached(); await crashed; return base; } }, async ({ runtime, sent, api, webhook }) => {
    assert.equal((await api("/profile", "PUT", { notifyPhone: "(92) 99999-1234" })).status, 200);
    const abandoned = webhook("crash-notice", senderJid, "Mensagem perdida na queda");
    await reachedLlm;
    await runtime.database.query("UPDATE evolution_go_webhook_claims SET claim_token='claim-of-dead-process'");

    now = "2026-04-01T00:05:00.000Z";
    await runtime.outboundWorker!.runOnce();
    await waitUntil(() => sent.some(({ recipientJid }) => recipientJid === "5592999991234"), "the workshop was not told");

    const notice = sent.find(({ recipientJid }) => recipientJid === "5592999991234")!;
    assert.equal(notice.content.includes("Mensagem perdida"), false);
    assert.deepEqual(sent.filter(({ recipientJid }) => recipientJid === senderJid), [{ recipientJid: senderJid, content: LLM_FAILURE_REPLY }]);
    assert.deepEqual((await runtime.database.query("SELECT reason FROM human_handoffs")).rows, [{ reason: "AI_FAILURE" }]);
    crash();
    await abandoned;
  });
});

test("the first reply to a customer carries the privacy notice, and only the first", { skip: !enabled }, async () => {
  const jid = "5511900000042@s.whatsapp.net";
  await withRuntime({ publicOrigin: "https://atendente.example.com" }, async ({ runtime, sent, webhook }) => {
    assert.equal((await webhook("privacy-1", jid, "Oi", "Carlos")).status, 202);
    assert.equal(sent[0]?.content, `${PRIVACY_NOTICE_PREFIX} Auto Fase 3. Seus dados são tratados para o seu atendimento. Saiba mais em https://atendente.example.com/privacidade.\n\nResposta sintética`);
    assert.equal((await webhook("privacy-2", jid, "E aí?")).status, 202);
    assert.equal(sent[1]?.content, "Resposta sintética");
    assert.notEqual((await runtime.database.query<{ at: string | null }>("SELECT privacy_notice_at AS at FROM customers")).rows[0]!.at, null);

    const page = await fetch(`http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}/privacidade`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Minuta sujeita a revisão jurídica/);
  });
});

test("migrations booting together apply once each, and the folder is found without depending on the working directory", { skip: !enabled }, async () => {
  const admin = new PostgresDatabase(config, { allowInsecureLocal: true });
  const schema = `fase3_migrate_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const first = new PostgresDatabase(config, { allowInsecureLocal: true, searchPath: schema });
  const second = new PostgresDatabase(config, { allowInsecureLocal: true, searchPath: schema });
  const cwd = process.cwd();
  try {
    process.chdir(join(cwd, "dist-test"));
    const results = await Promise.all([applyPostgresMigrations(first), applyPostgresMigrations(second)]);
    assert.deepEqual(results.map(({ length }) => length).sort((a, b) => a - b), [0, MIGRATIONS.length]);
    assert.equal((await first.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations")).rows[0]!.n, MIGRATIONS.length);
    assert.ok(findMigrationsDirectory(join(cwd, "dist-test", "src", "infrastructure", "postgres")).endsWith("migrations"));
  } finally {
    process.chdir(cwd);
    await first.close();
    await second.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.close();
  }
});

test("the advisory lock is released when the locked operation fails, and the next holder waits for the first", { skip: !enabled }, async () => {
  const first = new PostgresDatabase(config, { allowInsecureLocal: true });
  const second = new PostgresDatabase(config, { allowInsecureLocal: true });
  const key = 24_000_099;
  try {
    await assert.rejects(first.withAdvisoryLock(key, async () => { throw new Error("boom"); }), /boom/);
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const holder = first.withAdvisoryLock(key, async () => { order.push("first in"); await held; order.push("first out"); });
    await waitUntil(() => order.length === 1, "the first holder did not start");
    const waiter = second.withAdvisoryLock(key, async () => { order.push("second in"); });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(order, ["first in"], "the second waits while the first holds the lock");
    release();
    await Promise.all([holder, waiter]);
    assert.deepEqual(order, ["first in", "first out", "second in"]);
  } finally {
    await first.close();
    await second.close();
  }
});

test("erasing a customer leaves no table with their phone, name, e-mail, plate or message text, and touches no one else", { skip: !enabled }, async () => {
  const erased = { jid: "5511900000050@s.whatsapp.net", phone: "5511900000050", name: "Joana Apagável", email: "joana.apagavel@example.com", plate: "ZZZ9Z99", secret: "SEGREDO-DA-JOANA-77" };
  const kept = { jid: "5511900000051@s.whatsapp.net", phone: "5511900000051", name: "Pedro Permanece", secret: "TEXTO-DO-PEDRO-88" };
  const interpret = async (content: string): Promise<AIInterpretation> => content.includes(erased.secret)
    ? { ...base, intent: Intent.QUOTE_REQUEST, extractedCustomerData: { name: erased.name, email: erased.email }, extractedVehicleData: { licensePlate: erased.plate, brand: "Chevrolet", model: "Onix" }, requestedItem: `pastilha de freio ${erased.secret}`, symptomDescription: `chiado ${erased.secret}`, requiresHuman: true }
    : { ...base, intent: Intent.QUOTE_REQUEST, requestedItem: "troca de óleo", symptomDescription: kept.secret };
  await withRuntime({ interpret }, async ({ runtime, webhook }) => {
    const database = runtime.database;
    assert.equal((await webhook("erase-1", erased.jid, `Quero orçamento. ${erased.secret}`, erased.name)).status, 202);
    assert.equal((await webhook("erase-2", kept.jid, `Quero orçamento. ${kept.secret}`, kept.name)).status, 202);

    const customerId = (await database.query<{ id: string }>("SELECT id FROM customers WHERE primary_phone=$1", [erased.phone])).rows[0]!.id;
    const conversationId = (await database.query<{ id: string }>("SELECT id FROM conversations WHERE customer_id=$1", [customerId])).rows[0]!.id;
    const quoteId = (await database.query<{ id: string }>("SELECT id FROM quote_requests WHERE conversation_id=$1", [conversationId])).rows[0]!.id;
    const assistantMessageId = (await database.query<{ id: string }>("SELECT id FROM messages WHERE conversation_id=$1 AND sender_type='ASSISTANT'", [conversationId])).rows[0]!.id;
    const at = "2026-01-01T00:00:00.000Z";
    // Rows the conversation flow does not create by itself, so the deletion order is exercised for every table.
    await database.query("INSERT INTO appointments(id,business_id,conversation_id,customer_id,status,request_description,created_at,updated_at) VALUES('appt-1',$1,$2,$3,'REQUESTED',$4,$5,$5)", [businessId, conversationId, customerId, `agendar ${erased.secret}`, at]);
    await database.query("INSERT INTO outbound_deliveries(id,business_id,message_id,quote_request_id,conversation_id,channel,recipient_ref,status,attempts,created_at,updated_at) VALUES('delivery-1',$1,$2,$3,$4,'WHATSAPP',$5,'DELIVERED',1,$6,$6)", [businessId, assistantMessageId, quoteId, conversationId, erased.jid, at]);
    await database.query("INSERT INTO quote_drafts(id,business_id,conversation_id,quote_request_id,revision,status,products_subtotal_amount_cents,products_subtotal_currency,labor_subtotal_amount_cents,labor_subtotal_currency,total_amount_cents,total_currency,created_at,updated_at) VALUES('draft-1',$1,$2,$3,1,'DRAFT',0,'BRL',0,'BRL',0,'BRL',$4,$4)", [businessId, conversationId, quoteId, at]);
    await database.query("INSERT INTO quote_draft_lines(id,business_id,quote_draft_id,kind,description,quantity,unit,unit_price_captured_amount_cents,unit_price_captured_currency,subtotal_amount_cents,subtotal_currency,source,checked_at,quantity_source) VALUES('line-1',$1,'draft-1','PRODUCT',$2,1,'un',0,'BRL',0,'BRL','test',$3,'OPERATOR_CONFIRMED')", [businessId, `pastilha ${erased.secret}`, at]);
    await database.query("INSERT INTO stock_checks(id,business_id,conversation_id,quote_request_id,requested_item,inventory_reference,availability,source,checked_at) VALUES('stock-1',$1,$2,$3,$4,'ref','AVAILABLE','test',now())", [businessId, conversationId, quoteId, `pastilha ${erased.secret}`]);
    await database.query("INSERT INTO ai_usage_events(id,business_id,conversation_id,provider,model) VALUES('usage-1',$1,$2,'openai','modelo')", [businessId, conversationId]);
    await database.query("INSERT INTO assistant_health_events(id,business_id,event_type,conversation_id,occurred_at) VALUES('health-1',$1,'LLM_FAILED',$2,$3)", [businessId, conversationId, at]);

    const strings = [erased.phone, erased.name, erased.email, erased.plate, erased.secret, "Joana"];
    const tables = (await database.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname=current_schema()")).rows.map(({ tablename }) => tablename);
    const leaks = async () => {
      const found: string[] = [];
      for (const table of tables) {
        const rows = (await database.query<{ row: string }>(`SELECT t::text AS row FROM "${table}" t`)).rows;
        for (const { row } of rows) for (const text of strings) if (row.includes(text)) found.push(`${table}: ${text}`);
      }
      return found;
    };
    assert.ok((await leaks()).length > 0, "the fixture really holds the personal data before the erasure");
    const keptBefore = (await database.query("SELECT count(*)::int AS n FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE customer_id<>$1)", [customerId])).rows[0];

    // psql substitutes :'name' as a quoted literal before sending; the test does the same.
    const script = readFileSync(join(__dirname, "..", "..", "..", "scripts", "erase-customer.sql"), "utf8")
      .replaceAll(":'business_id'", `'${businessId}'`).replaceAll(":'customer_id'", `'${customerId}'`);
    await database.query(script);

    assert.deepEqual(await leaks(), []);
    assert.deepEqual((await database.query("SELECT count(*)::int AS n FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE customer_id<>$1)", [customerId])).rows[0], keptBefore);
    assert.equal((await database.query<{ n: number }>("SELECT count(*)::int AS n FROM customers WHERE primary_phone=$1 AND name=$2", [kept.phone, kept.name])).rows[0]!.n, 1);
    assert.equal((await database.query<{ n: number }>("SELECT count(*)::int AS n FROM evolution_go_conversation_links WHERE sender_jid=$1", [kept.jid])).rows[0]!.n, 1);
    assert.equal((await database.query<{ n: number }>("SELECT count(*)::int AS n FROM commercial_events")).rows[0]!.n, 2, "events stay, anonymized");
    assert.deepEqual((await database.query("SELECT requested_item FROM commercial_events ORDER BY requested_item")).rows, [{ requested_item: "troca de óleo" }, { requested_item: null }]);
    assert.equal((await database.query<{ n: number }>("SELECT count(*)::int AS n FROM ai_usage_events WHERE conversation_id IS NULL")).rows[0]!.n, 1);
  });
});
