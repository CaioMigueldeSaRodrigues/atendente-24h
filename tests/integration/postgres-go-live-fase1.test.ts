import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createBasicPlanPostgresRuntime } from "../../src/app/basic-plan-postgres-runtime.js";
import { BusinessType, Channel, ConversationStatus, Intent, OpportunityStatus, OutboundDeliveryStatus, QuoteRequestStatus, SenderType } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { LLM_FAILURE_REPLY, LLM_LIMITED_REPLY } from "../../src/core/response-policy.js";
import { PostgresDatabase, type PostgresEnvironment } from "../../src/infrastructure/postgres/postgres-database.js";
import { applyPostgresMigrations } from "../../src/infrastructure/postgres/postgres-migrations.js";
import { postgresTestConfig, postgresTestEnabled } from "../postgres-test-environment.js";

const config: PostgresEnvironment = postgresTestConfig();
const enabled = postgresTestEnabled();
const businessId = "fase1-business";
const instanceName = "fase1-instance";
const instanceToken = "fase1-token";
const authorization = "Basic fase1-operator";
const webhookPath = "/v1/channels/whatsapp/evolution-go/webhook";
const interpretation: AIInterpretation = {
  intent: Intent.GENERAL_INFORMATION,
  extractedCustomerData: {},
  extractedVehicleData: {},
  missingData: [],
  suggestedNextAction: { type: "NONE", description: "Nenhuma ação" },
  requiresHuman: false,
  proposedResponse: "Resposta sintética",
};

type RuntimeOptions = {
  interpret?: () => Promise<AIInterpretation>;
  sendText?: () => Promise<void>;
  llmDailyCallsPerBusiness?: number;
  now?: () => string;
};

async function withRuntime(options: RuntimeOptions, run: (context: {
  runtime: Awaited<ReturnType<typeof createBasicPlanPostgresRuntime>>;
  base: string;
  sent: Array<{ recipientJid: string; content: string }>;
  webhook: (externalMessageId: string, senderJid: string, content?: string) => Promise<Response>;
}) => Promise<void>) {
  const schema = `fase1_${randomUUID().replaceAll("-", "")}`;
  const admin = new PostgresDatabase(config, { allowInsecureLocal: true });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const sent: Array<{ recipientJid: string; content: string }> = [];
  const runtime = await createBasicPlanPostgresRuntime({
    postgres: config,
    postgresSearchPathForTests: schema,
    allowInsecureLocalForTests: true,
    ...(options.llmDailyCallsPerBusiness === undefined ? {} : { llmDailyCallsPerBusiness: options.llmDailyCallsPerBusiness }),
    ...(options.now === undefined ? {} : { now: options.now }),
    business: { businessId, businessName: "Fase 1", businessType: BusinessType.OTHER, timezone: "UTC" },
    businessOperatorAuthorizer: { isAuthorized: async (input) => input.businessId === businessId && input.credential === authorization },
    evolutionGoWebhookCredential: { businessId, instanceName, instanceToken },
    evolutionGoTextSender: { sendText: async (message) => { await options.sendText?.(); sent.push(message); } },
    interpreter: { interpret: options.interpret ?? (async () => interpretation) },
  });
  await new Promise<void>((resolve) => { runtime.server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const webhook = (externalMessageId: string, senderJid: string, content = "Olá") => fetch(base + webhookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: "Message", instanceName, instanceToken,
      data: { Info: { ID: externalMessageId, Type: "text", Sender: senderJid, Timestamp: (options.now ?? (() => new Date().toISOString()))(), IsFromMe: false, IsGroup: false }, Message: { conversation: content } },
    }),
  });
  try {
    await run({ runtime, base, sent, webhook });
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

test("30 messages waiting for a slow LLM hold no pool connection: /health and the panel answer", { skip: !enabled }, async () => {
  let entered = 0;
  let release!: () => void;
  const llmBlocked = new Promise<void>((resolve) => { release = resolve; });
  await withRuntime({ interpret: async () => { entered += 1; await llmBlocked; return interpretation; } }, async ({ runtime, base, sent, webhook }) => {
    const pending = Array.from({ length: 30 }, (_, index) => webhook(`slow-${index}`, `55119000000${String(index).padStart(2, "0")}@s.whatsapp.net`));
    try {
      await waitUntil(() => entered === 30, "the 30 messages did not reach the LLM");

      const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_000) });
      assert.equal(health.status, 200);
      const panel = await fetch(`${base}/v1/businesses/${businessId}/quotes/pending`, { headers: { authorization }, signal: AbortSignal.timeout(2_000) });
      assert.equal(panel.status, 200);
      const stored = await runtime.database.query<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE sender_type='CUSTOMER'");
      assert.equal(stored.rows[0]!.n, 30);
      const openTransactions = await runtime.database.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='atendente-24h' AND state LIKE 'idle in transaction%' AND query LIKE '%messages%'");
      assert.equal(openTransactions.rows[0]!.n, 0);
    } finally {
      release();
    }
    const responses = await Promise.all(pending);
    assert.deepEqual([...new Set(responses.map(({ status }) => status))], [202]);
    assert.equal(sent.length, 30);
    const total = await runtime.database.query<{ n: number }>("SELECT count(*)::int AS n FROM messages");
    assert.equal(total.rows[0]!.n, 60);
  });
});

test("messages of one sender keep one conversation and every reply under concurrency", { skip: !enabled }, async () => {
  await withRuntime({}, async ({ runtime, sent, webhook }) => {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => webhook(`same-sender-${index}`, "5511900000099@s.whatsapp.net")));
    assert.deepEqual([...new Set(responses.map(({ status }) => status))], [202]);
    assert.equal(sent.length, 8);
    const rows = await runtime.database.query<{ conversations: number; customers: number; assistants: number }>("SELECT count(DISTINCT conversation_id)::int AS conversations, count(*) FILTER (WHERE sender_type=$1)::int AS customers, count(*) FILTER (WHERE sender_type=$2)::int AS assistants FROM messages", [SenderType.CUSTOMER, SenderType.ASSISTANT]);
    assert.deepEqual(rows.rows[0], { conversations: 1, customers: 8, assistants: 8 });
  });
});

test("the daily ceiling reads ai_usage_events and blocks the LLM", { skip: !enabled }, async () => {
  let calls = 0;
  await withRuntime({ llmDailyCallsPerBusiness: 1, interpret: async () => { calls += 1; return interpretation; } }, async ({ runtime, sent, webhook }) => {
    assert.equal((await webhook("below-ceiling", "5511900000001@s.whatsapp.net")).status, 202);
    await runtime.database.query("INSERT INTO ai_usage_events(id,business_id,provider,model,created_at) VALUES('usage-1',$1,'openai','m',now())", [businessId]);
    assert.equal((await webhook("above-ceiling", "5511900000002@s.whatsapp.net")).status, 202);
    assert.equal(calls, 1);
    assert.equal(sent.at(-1)!.content, LLM_LIMITED_REPLY);
  });
});

async function waitForRowLockWaiter(database: PostgresDatabase): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await database.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT 1 FROM quote_requests%'");
    if (waiting.rows[0]!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("customer intake never waited for the operator transaction");
}

test("customer intake racing with an operator transaction never overwrites price or draft", { skip: !enabled }, async () => {
  await withRuntime({}, async ({ runtime, webhook }) => {
    assert.equal((await webhook("seed", "5511900000003@s.whatsapp.net")).status, 202);
    const { QuoteRequestRepository, conversationId } = await seedQuote(runtime.database);
    const stale = (await QuoteRequestRepository.findById(businessId, "quote-race"))!;
    const schema = (await runtime.database.query<{ schema: string }>("SELECT current_schema() AS schema")).rows[0]!.schema;
    const operator = new PostgresDatabase(config, { allowInsecureLocal: true, searchPath: schema });
    try {
      let intake!: Promise<boolean>;
      await operator.transaction(async (client) => {
        await client.query("UPDATE quote_requests SET authorized_price_amount_cents=28200,authorized_price_currency='BRL',status=$1 WHERE id='quote-race'", [QuoteRequestStatus.RESPONDED]);
        intake = QuoteRequestRepository.updateIntake({ ...stale, requestDescription: "Outro pedido" });
        await waitForRowLockWaiter(runtime.database);
      });
      assert.equal(await intake, false);
      assert.deepEqual((await runtime.database.query("SELECT request_description,authorized_price_amount_cents FROM quote_requests WHERE id='quote-race'")).rows, [{ request_description: "Pedido original", authorized_price_amount_cents: "28200" }]);

      await runtime.database.query("UPDATE quote_requests SET authorized_price_amount_cents=NULL,authorized_price_currency=NULL,status=$1 WHERE id='quote-race'", [QuoteRequestStatus.WAITING_BUSINESS]);
      await operator.transaction(async (client) => {
        await client.query("SELECT id FROM quote_requests WHERE id='quote-race' FOR UPDATE");
        intake = QuoteRequestRepository.updateIntake({ ...stale, requestDescription: "Outro pedido" });
        await waitForRowLockWaiter(runtime.database);
        await client.query("INSERT INTO quote_drafts(id,business_id,conversation_id,quote_request_id,revision,status,products_subtotal_amount_cents,products_subtotal_currency,labor_subtotal_amount_cents,labor_subtotal_currency,total_amount_cents,total_currency,created_at,updated_at) VALUES('draft-race',$1,$2,'quote-race',1,'PENDING_APPROVAL',100,'BRL',0,'BRL',100,'BRL','2026-01-01','2026-01-01')", [businessId, conversationId]);
      });
      assert.equal(await intake, false);
      await runtime.database.query("UPDATE quote_drafts SET status='SUPERSEDED' WHERE id='draft-race'");
      assert.equal(await QuoteRequestRepository.updateIntake({ ...stale, requestDescription: "Outro pedido" }), true);
    } finally {
      await operator.close();
    }
  });
});

async function seedQuote(database: PostgresDatabase) {
  const { PostgresQuoteRequestRepository, PostgresOpportunityRepository } = await import("../../src/infrastructure/postgres/postgres-repositories.js");
  const conversationId = (await database.query<{ id: string }>("SELECT id FROM conversations LIMIT 1")).rows[0]!.id;
  const at = "2026-01-01T00:00:00.000Z";
  await new PostgresOpportunityRepository(database).save({ id: "opportunity-race", businessId, conversationId, status: OpportunityStatus.WAITING_BUSINESS, createdAt: at, updatedAt: at });
  const QuoteRequestRepository = new PostgresQuoteRequestRepository(database);
  await QuoteRequestRepository.save({ id: "quote-race", businessId, opportunityId: "opportunity-race", conversationId, requestDescription: "Pedido original", status: QuoteRequestStatus.WAITING_BUSINESS, requestedAt: at, createdAt: at, updatedAt: at });
  return { QuoteRequestRepository, conversationId };
}

test("the worker resends due deliveries and processed replies, with durable backoff", { skip: !enabled }, async () => {
  let fail = true;
  let now = "2026-02-01T00:00:00.000Z";
  await withRuntime({ now: () => now, sendText: async () => { if (fail) throw new Error("synthetic sender failure"); } }, async ({ runtime, sent, webhook }) => {
    const senderJid = "5511900000004@s.whatsapp.net";
    assert.equal((await webhook("reply-pending", senderJid)).status, 503);
    assert.equal(sent.length, 0);
    const worker = runtime.outboundWorker!;

    await worker.runOnce();
    const inGrace = await runtime.database.query("SELECT status,retry_attempts FROM evolution_go_webhook_receipts");
    assert.deepEqual(inGrace.rows, [{ status: "processed", retry_attempts: 0 }]);

    now = "2026-02-01T00:03:00.000Z";
    await worker.runOnce();
    assert.deepEqual((await runtime.database.query("SELECT status,retry_attempts,next_retry_at FROM evolution_go_webhook_receipts")).rows, [{ status: "processed", retry_attempts: 1, next_retry_at: "2026-02-01T00:04:00.000Z" }]);

    await worker.runOnce();
    assert.equal((await runtime.database.query<{ retry_attempts: number }>("SELECT retry_attempts FROM evolution_go_webhook_receipts")).rows[0]!.retry_attempts, 1);

    const conversationId = (await runtime.database.query<{ conversation_id: string }>("SELECT conversation_id FROM evolution_go_webhook_receipts")).rows[0]!.conversation_id;
    await seedDelivery(runtime.database, conversationId, now);
    fail = false;
    now = "2026-02-01T00:04:00.000Z";
    await worker.runOnce();
    assert.deepEqual(sent.map(({ recipientJid }) => recipientJid), [senderJid, senderJid]);
    assert.deepEqual((await runtime.database.query("SELECT status FROM outbound_deliveries")).rows, [{ status: OutboundDeliveryStatus.DELIVERED }]);
    assert.deepEqual((await runtime.database.query("SELECT status FROM evolution_go_webhook_receipts")).rows, [{ status: "sent" }]);

    await worker.runOnce();
    assert.equal(sent.length, 2);
  });
});

async function seedDelivery(database: PostgresDatabase, conversationId: string, at: string): Promise<void> {
  await database.query("INSERT INTO opportunities(id,business_id,conversation_id,status,created_at,updated_at) VALUES('opportunity-out',$1,$2,$3,$4,$4)", [businessId, conversationId, OpportunityStatus.WAITING_CUSTOMER, at]);
  await database.query("INSERT INTO quote_requests(id,business_id,opportunity_id,conversation_id,request_description,status,requested_at,created_at,updated_at) VALUES('quote-out',$1,'opportunity-out',$2,'Pedido',$3,$4,$4,$4)", [businessId, conversationId, QuoteRequestStatus.RESPONDED, at]);
  await database.query("INSERT INTO messages(id,business_id,conversation_id,sender_type,channel,content,created_at) VALUES('message-out',$1,$2,$3,$4,'Orçamento',$5)", [businessId, conversationId, SenderType.ASSISTANT, Channel.WHATSAPP, at]);
  await database.query("INSERT INTO outbound_deliveries(id,business_id,message_id,quote_request_id,conversation_id,channel,status,attempts,last_error,next_attempt_at,created_at,updated_at) VALUES('delivery-out',$1,'message-out','quote-out',$2,$3,$4,1,'x',$5,$5,$5)", [businessId, conversationId, Channel.WHATSAPP, OutboundDeliveryStatus.FAILED_RETRYABLE, at]);
}

test("every table has RLS and API roles lose their grants", { skip: !enabled }, async () => {
  const admin = new PostgresDatabase(config, { allowInsecureLocal: true });
  const schema = `fase1_rls_${randomUUID().replaceAll("-", "")}`;
  const db = new PostgresDatabase(config, { allowInsecureLocal: true, searchPath: schema });
  try {
    // ponytail: the anon role stays in the disposable test database; dropping it races with migrations of parallel test files.
    await admin.query("DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$");
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO anon`);
    // Mirrors Supabase, whose default privileges grant every new table to anon.
    await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL ON TABLES TO anon`);
    await applyPostgresMigrations(db);

    const withoutRls = await admin.query(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND NOT c.relrowsecurity",
      [schema],
    );
    assert.deepEqual(withoutRls.rows, []);
    const tables = await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname=$1", [schema]);
    assert.ok(tables.rows[0]!.n > 20);
    const granted = await admin.query(
      "SELECT table_name FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema=$1",
      [schema],
    );
    assert.deepEqual(granted.rows, []);
  } finally {
    await db.close();
    await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" REVOKE ALL ON TABLES FROM anon`).catch(() => undefined);
    await admin.query(`REVOKE ALL ON SCHEMA "${schema}" FROM anon`).catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.close();
  }
});

async function seedForeignScope(database: PostgresDatabase, at: string): Promise<void> {
  const foreign = "fase1-other-business";
  await database.query("INSERT INTO automotive_businesses(id,name,business_type,timezone,active,created_at,updated_at) VALUES($1,$1,$2,'UTC',true,$3,$3)", [foreign, BusinessType.OTHER, at]);
  await database.query("INSERT INTO conversations(id,business_id,channel,status,started_at,last_message_at) VALUES('conversation-b',$1,$2,$3,$4,$4)", [foreign, Channel.WHATSAPP, ConversationStatus.ACTIVE, at]);
  await database.query("INSERT INTO evolution_go_conversation_links(business_id,instance_name,sender_jid,conversation_id,created_at,updated_at) VALUES($1,'instance-b','b@s.whatsapp.net','conversation-b',$2,$2)", [foreign, at]);
  await database.query("INSERT INTO opportunities(id,business_id,conversation_id,status,created_at,updated_at) VALUES('opportunity-b',$1,'conversation-b',$2,$3,$3)", [foreign, OpportunityStatus.WAITING_CUSTOMER, at]);
  await database.query("INSERT INTO quote_requests(id,business_id,opportunity_id,conversation_id,request_description,status,requested_at,created_at,updated_at) VALUES('quote-b',$1,'opportunity-b','conversation-b','Pedido',$2,$3,$3,$3)", [foreign, QuoteRequestStatus.RESPONDED, at]);
  await database.query("INSERT INTO messages(id,business_id,conversation_id,sender_type,channel,content,external_message_id,created_at) VALUES('message-b',$1,'conversation-b',$2,$3,'Dado da oficina B','external-b',$4)", [foreign, SenderType.ASSISTANT, Channel.WHATSAPP, at]);
  await database.query("INSERT INTO outbound_deliveries(id,business_id,message_id,quote_request_id,conversation_id,channel,recipient_ref,status,attempts,next_attempt_at,created_at,updated_at) VALUES('delivery-b',$1,'message-b','quote-b','conversation-b',$2,'b@s.whatsapp.net',$3,1,$4,$4,$4)", [foreign, Channel.WHATSAPP, OutboundDeliveryStatus.FAILED_RETRYABLE, at]);
  await database.query("INSERT INTO evolution_go_webhook_receipts(business_id,instance_name,external_message_id,received_at,status,conversation_id,sender_jid,reply) VALUES($1,'instance-b','receipt-b',$2,'processed','conversation-b','b@s.whatsapp.net','Resposta da oficina B')", [foreign, at]);
  await database.query("INSERT INTO evolution_go_webhook_claims(business_id,instance_name,external_message_id,claim_token,received_at,claimed_at,lease_until) VALUES($1,'instance-b','external-b','token-b',$2,$2,$2)", [foreign, at]);
}

test("the worker of one business never reads or sends what belongs to another", { skip: !enabled }, async () => {
  const at = "2026-03-01T00:00:00.000Z";
  await withRuntime({ now: () => "2026-03-01T01:00:00.000Z" }, async ({ runtime, sent }) => {
    await seedForeignScope(runtime.database, at);
    await runtime.database.query("INSERT INTO conversations(id,business_id,channel,status,started_at,last_message_at) VALUES('conversation-a2',$1,$2,$3,$4,$4)", [businessId, Channel.WHATSAPP, ConversationStatus.ACTIVE, at]);
    await runtime.database.query("INSERT INTO evolution_go_webhook_receipts(business_id,instance_name,external_message_id,received_at,status,conversation_id,sender_jid,reply) VALUES($1,'other-instance','receipt-a2',$2,'processed','conversation-a2','a2@s.whatsapp.net','Outra instância')", [businessId, at]);

    await runtime.outboundWorker!.runOnce();

    assert.deepEqual(sent, []);
    assert.deepEqual((await runtime.database.query("SELECT status FROM outbound_deliveries WHERE id='delivery-b'")).rows, [{ status: OutboundDeliveryStatus.FAILED_RETRYABLE }]);
    assert.deepEqual((await runtime.database.query("SELECT status,retry_attempts FROM evolution_go_webhook_receipts ORDER BY external_message_id")).rows, [{ status: "processed", retry_attempts: 0 }, { status: "processed", retry_attempts: 0 }]);
    assert.equal((await runtime.database.query<{ n: number }>("SELECT count(*)::int AS n FROM evolution_go_webhook_claims WHERE claim_token='token-b'")).rows[0]!.n, 1);
  });
});

test("a crash during the LLM call is answered by the worker once, without any provider retry", { skip: !enabled }, async () => {
  let now = "2026-04-01T00:00:00.000Z";
  const senderJid = "5511900000006@s.whatsapp.net";
  let crash!: () => void;
  const crashed = new Promise<void>((resolve) => { crash = resolve; });
  let llmReached!: () => void;
  const reachedLlm = new Promise<void>((resolve) => { llmReached = resolve; });
  await withRuntime({ now: () => now, interpret: async () => { llmReached(); await crashed; return interpretation; } }, async ({ runtime, sent, webhook }) => {
    const abandoned = webhook("crash-message", senderJid, "Mensagem perdida na queda");
    await reachedLlm;
    const database = runtime.database;
    // A killed process leaves exactly this: message committed, claim alive, nothing applied. The request is left hanging on purpose.
    await database.query("UPDATE evolution_go_webhook_claims SET claim_token='claim-of-dead-process'");
    await runtime.outboundWorker!.runOnce();
    assert.deepEqual(sent, [], "the lease has not expired yet");

    now = "2026-04-01T00:05:00.000Z";
    await runtime.outboundWorker!.runOnce();
    await runtime.outboundWorker!.runOnce();

    assert.deepEqual(sent, [{ recipientJid: senderJid, content: LLM_FAILURE_REPLY }]);
    assert.deepEqual((await database.query("SELECT sender_type,content FROM messages ORDER BY sender_type DESC")).rows, [{ sender_type: "CUSTOMER", content: "Mensagem perdida na queda" }, { sender_type: "ASSISTANT", content: LLM_FAILURE_REPLY }]);
    assert.deepEqual((await database.query("SELECT reason,summary FROM human_handoffs")).rows, [{ reason: "AI_FAILURE", summary: "Mensagem perdida na queda" }]);
    assert.deepEqual((await database.query("SELECT status FROM conversations")).rows, [{ status: ConversationStatus.WAITING_HUMAN }]);
    assert.deepEqual((await database.query("SELECT status FROM evolution_go_webhook_receipts")).rows, [{ status: "sent" }]);
    assert.equal((await database.query<{ n: number }>("SELECT count(*)::int AS n FROM evolution_go_webhook_claims")).rows[0]!.n, 0);

    crash();
    assert.equal((await abandoned).status, 500);
    assert.equal(sent.length, 1);
  });
});

test("replies stop once a person takes the conversation and expire after 24 hours", { skip: !enabled }, async () => {
  let now = "2026-05-01T00:00:00.000Z";
  let fail = true;
  await withRuntime({ now: () => now, sendText: async () => { if (fail) throw new Error("synthetic sender failure"); } }, async ({ runtime, sent, webhook }) => {
    assert.equal((await webhook("reply-human", "5511900000007@s.whatsapp.net")).status, 503);
    assert.equal((await webhook("reply-old", "5511900000008@s.whatsapp.net")).status, 503);
    // Waiting for a person is not enough: the reply is dropped only after the person takes the handoff.
    await runtime.database.query("UPDATE conversations SET status=$1 WHERE id=(SELECT conversation_id FROM evolution_go_webhook_receipts WHERE external_message_id='reply-human')", [ConversationStatus.WAITING_HUMAN]);
    await runtime.database.query("INSERT INTO human_handoffs(id,business_id,conversation_id,reason,summary,status,assigned_to,requested_at,accepted_at,created_at,updated_at) SELECT 'handoff-taken',business_id,conversation_id,'CUSTOMER_REQUEST','Oi','ACCEPTED','operador',received_at,'2026-05-01T00:01:00.000Z',received_at,received_at FROM evolution_go_webhook_receipts WHERE external_message_id='reply-human'");
    fail = false;
    now = "2026-05-01T00:03:00.000Z";
    await runtime.database.query("UPDATE evolution_go_webhook_receipts SET received_at='2026-04-29T00:00:00.000Z' WHERE external_message_id='reply-old'");

    await runtime.outboundWorker!.runOnce();

    assert.deepEqual(sent, []);
    assert.deepEqual((await runtime.database.query("SELECT external_message_id,status FROM evolution_go_webhook_receipts ORDER BY external_message_id")).rows, [
      { external_message_id: "reply-human", status: "processed" },
      { external_message_id: "reply-old", status: "failed" },
    ]);
  });
});

test("an operator retry goes through a delivery the worker scheduled for later", { skip: !enabled }, async () => {
  const at = "2026-06-01T00:00:00.000Z";
  await withRuntime({ now: () => at }, async ({ runtime, base, sent, webhook }) => {
    assert.equal((await webhook("seed-manual", "5511900000009@s.whatsapp.net")).status, 202);
    const conversationId = (await runtime.database.query<{ conversation_id: string }>("SELECT conversation_id FROM evolution_go_webhook_receipts")).rows[0]!.conversation_id;
    await seedDelivery(runtime.database, conversationId, at);
    await runtime.database.query("UPDATE quote_requests SET authorized_price_amount_cents=100,authorized_price_currency='BRL' WHERE id='quote-out'");
    await runtime.database.query("UPDATE outbound_deliveries SET next_attempt_at='2026-06-01T02:00:00.000Z'");

    const response = await fetch(`${base}/v1/businesses/${businessId}/quotes/quote-out/publish`, { method: "POST", headers: { authorization } });

    assert.equal(response.status, 200);
    assert.equal(sent.at(-1)!.content, "Orçamento");
    assert.deepEqual((await runtime.database.query("SELECT status FROM outbound_deliveries")).rows, [{ status: OutboundDeliveryStatus.DELIVERED }]);
  });
});

test("the worker does not touch a healthy conversation", { skip: !enabled }, async () => {
  await withRuntime({}, async ({ runtime, sent, webhook }) => {
    assert.equal((await webhook("healthy", "5511900000005@s.whatsapp.net")).status, 202);
    await runtime.outboundWorker!.runOnce();
    assert.equal(sent.length, 1);
    assert.deepEqual((await runtime.database.query("SELECT status FROM conversations")).rows, [{ status: ConversationStatus.ACTIVE }]);
  });
});
