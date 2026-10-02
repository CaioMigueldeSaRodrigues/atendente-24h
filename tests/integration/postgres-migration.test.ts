import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { resolveEvolutionGoConversation } from "../../src/channels/whatsapp/evolution-go-conversation-resolver.js";
import { AppointmentStatus, AssistantHealthEventType, BusinessType, Channel, CommercialEventType, ConversationStatus, HandoffReason, HandoffStatus, Intent, OpportunityStatus, QuoteRequestStatus, SenderType } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { PostgresDatabase, type PostgresEnvironment } from "../../src/infrastructure/postgres/postgres-database.js";
import { applyPostgresMigrations } from "../../src/infrastructure/postgres/postgres-migrations.js";
import { initializeSqliteSchema } from "../../src/infrastructure/sqlite/sqlite-database.js";
import { transferSqliteToPostgres } from "../../src/infrastructure/postgres/transfer-sqlite-to-postgres.js";
import {
  PostgresAppointmentRepository, PostgresAssistantHealthEventRepository, PostgresAutomotiveBusinessRepository,
  PostgresCommercialEventRepository, PostgresConversationRepository,
  PostgresCustomerRepository, PostgresEvolutionGoConversationLinkRepository,
  PostgresEvolutionGoWebhookReplayGuard, PostgresHumanHandoffRepository, PostgresMessageRepository,
  PostgresOpportunityRepository, PostgresQuoteRequestRepository, PostgresVehicleRepository,
  evolutionGoConversationAdvisoryLockKey,
} from "../../src/infrastructure/postgres/postgres-repositories.js";
import { createBasicPlanPostgresRuntime } from "../../src/app/basic-plan-postgres-runtime.js";

const config: PostgresEnvironment = {
  host: process.env.POSTGRES_TEST_HOST ?? "127.0.0.1",
  port: Number(process.env.POSTGRES_TEST_PORT ?? 55432),
  database: process.env.POSTGRES_TEST_DATABASE ?? "postgres",
  user: process.env.POSTGRES_TEST_USER ?? "postgres",
  password: process.env.POSTGRES_TEST_PASSWORD ?? "",
};
const enabled = Boolean(process.env.POSTGRES_TEST_PASSWORD);
const runtimeInterpretation: AIInterpretation = {
  intent: Intent.GENERAL_INFORMATION,
  extractedCustomerData: {},
  extractedVehicleData: {},
  missingData: [],
  suggestedNextAction: { type: "NONE", description: "Nenhuma ação adicional" },
  requiresHuman: false,
  proposedResponse: "Resposta sintética do PostgreSQL",
};

async function waitForAdvisoryLockWaiters(database: PostgresDatabase, expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await database.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE 'SELECT pg_advisory_xact_lock(hashtextextended%'
    `);
    if (Number(result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Concurrent PostgreSQL resolutions did not reach the advisory lock barrier");
}

test("PostgreSQL migrations and repositories persist tenant data and serialize conversation resolution", { skip: !enabled }, async () => {
  const db = new PostgresDatabase(config, { allowInsecureLocal: true });
  const businessId = `pg-test-${process.pid}-${Date.now()}`;
  try {
    const first = await applyPostgresMigrations(db);
    assert.ok(first.every((version)=>[
      "001_initial_schema.sql",
      "002_appointment_and_handoff_repositories.sql",
      "003_evolution_go_webhook_processing.sql",
      "004_outbound_delivery_outbox.sql",
      "005_stock_checks_read_only.sql",
    ].includes(version)));
    assert.deepEqual(await applyPostgresMigrations(db),[]);
    const transferBusinessId=`transfer-test-${businessId}`;
    const directory=mkdtempSync(join(tmpdir(),"att24-pg-transfer-"));
    const sqlitePath=join(directory,"source.sqlite");
    const source=new DatabaseSync(sqlitePath);
    initializeSqliteSchema(source);
    source.prepare("INSERT INTO automotive_businesses(id,name,business_type,timezone,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(transferBusinessId,transferBusinessId,BusinessType.OTHER,"UTC",1,"2026-01-01","2026-01-01");
    source.close();
    await transferSqliteToPostgres(sqlitePath,db);
    assert.equal((await new PostgresAutomotiveBusinessRepository(db).findById(transferBusinessId))?.active,true);
    await db.query("DELETE FROM automotive_businesses WHERE id=$1",[transferBusinessId]);
    rmSync(directory,{recursive:true,force:true});
    const businesses = new PostgresAutomotiveBusinessRepository(db);
    await businesses.save({ id:businessId,name:businessId,businessType:BusinessType.OTHER,timezone:"UTC",active:true,createdAt:"2026-01-01T00:00:00Z",updatedAt:"2026-01-01T00:00:00Z" });
    assert.equal((await businesses.findById(businessId))?.id,businessId);
    const conversations = new PostgresConversationRepository(db);
    const links = new PostgresEvolutionGoConversationLinkRepository(db);
    let id = 0;
    const resolutionKey = { businessId,instanceName:"local-test",senderJid:"sender@synthetic.invalid" };
    const resolve = () => resolveEvolutionGoConversation(resolutionKey, {
      conversationRepository:conversations,evolutionGoConversationLinkRepository:links,
      now:()=>"2026-01-02T00:00:00Z",generateId:()=>`conversation-${businessId}-${++id}`,
    });
    const blocker = new PostgresDatabase(config,{allowInsecureLocal:true});
    let announceLockAcquired!:()=>void;
    let releaseLock!:()=>void;
    const lockAcquired=new Promise<void>((resolveBarrier)=>{announceLockAcquired=resolveBarrier;});
    const lockRelease=new Promise<void>((resolveBarrier)=>{releaseLock=resolveBarrier;});
    const blockerTransaction=blocker.transaction(async(client)=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",[
        evolutionGoConversationAdvisoryLockKey(resolutionKey),
      ]);
      announceLockAcquired();
      await lockRelease;
    });
    let result: Awaited<ReturnType<typeof resolve>>[];
    try {
      await lockAcquired;
      const firstResolution=resolve();
      const secondResolution=resolve();
      await waitForAdvisoryLockWaiters(db,2);
      releaseLock();
      result=await Promise.all([firstResolution,secondResolution]);
      await blockerTransaction;
    } finally {
      releaseLock();
      await blockerTransaction.catch(()=>undefined);
      await blocker.close();
    }
    assert.equal(result[0]!.conversation.id,result[1]!.conversation.id);
    assert.equal(result.filter((item)=>item.created).length,1);
    assert.equal(result[0]!.conversation.channel,Channel.WHATSAPP);
    assert.equal(result[0]!.conversation.status,ConversationStatus.ACTIVE);
    const stored = await db.query("SELECT id FROM conversations WHERE business_id=$1",[businessId]);
    const linked = await db.query("SELECT conversation_id FROM evolution_go_conversation_links WHERE business_id=$1",[businessId]);
    assert.equal(stored.rowCount,1);
    assert.equal(linked.rowCount,1);

    const failingLinks={
      runAtomically:links.runAtomically.bind(links),
      findBySender:links.findBySender.bind(links),
      findByConversation:links.findByConversation.bind(links),
      save:async()=>{throw new Error("synthetic link storage failure");},
    };
    await assert.rejects(resolveEvolutionGoConversation({businessId,instanceName:"rollback-test",senderJid:"rollback@synthetic.invalid"},{
      conversationRepository:conversations,evolutionGoConversationLinkRepository:failingLinks,
      now:()=>"2026-01-02T00:00:00Z",generateId:()=>"rollback-conversation",
    }),/Unable to resolve WhatsApp conversation/);
    assert.equal((await db.query("SELECT id FROM conversations WHERE id='rollback-conversation'")).rowCount,0);
    const retried=await resolveEvolutionGoConversation({businessId,instanceName:"rollback-test",senderJid:"rollback@synthetic.invalid"},{
      conversationRepository:conversations,evolutionGoConversationLinkRepository:links,
      now:()=>"2026-01-02T00:00:00Z",generateId:()=>"rollback-conversation-retry",
    });
    assert.equal(retried.created,true);
    assert.equal((await links.findBySender(businessId,"rollback-test","rollback@synthetic.invalid"))?.conversationId,"rollback-conversation-retry");

    const customerRepo = new PostgresCustomerRepository(db);
    const vehicleRepo = new PostgresVehicleRepository(db);
    const messageRepo = new PostgresMessageRepository(db);
    const opportunityRepo = new PostgresOpportunityRepository(db);
    const quoteRepo = new PostgresQuoteRequestRepository(db);
    const conversation = result[0]!.conversation;
    await customerRepo.save({id:"customer-1",businessId,name:"Test customer",createdAt:"2026-01-02",updatedAt:"2026-01-02"});
    await vehicleRepo.save({id:"vehicle-1",businessId,customerId:"customer-1",brand:"Test",createdAt:"2026-01-02",updatedAt:"2026-01-02"});
    await conversations.save({...conversation,customerId:"customer-1",vehicleId:"vehicle-1"});
    await messageRepo.save({id:"message-1",businessId,conversationId:conversation.id,senderType:SenderType.CUSTOMER,channel:Channel.WHATSAPP,content:"local PostgreSQL test",createdAt:"2026-01-02"});
    assert.equal((await messageRepo.listByConversation(businessId,conversation.id)).length,1);
    const opportunity = {id:"opportunity-1",businessId,conversationId:conversation.id,customerId:"customer-1",vehicleId:"vehicle-1",status:OpportunityStatus.OPEN,estimatedValue:{amountCents:12345,currency:"BRL" as const},createdAt:"2026-01-02",updatedAt:"2026-01-02"};
    await opportunityRepo.save(opportunity);
    assert.deepEqual(await opportunityRepo.findById(businessId,opportunity.id),opportunity);
    const quote = {id:"quote-1",businessId,opportunityId:opportunity.id,conversationId:conversation.id,requestDescription:"service",status:QuoteRequestStatus.REQUESTED,requestedAt:"2026-01-02",createdAt:"2026-01-02",updatedAt:"2026-01-02"};
    await quoteRepo.save(quote);
    assert.deepEqual(await quoteRepo.findById(businessId,quote.id),quote);
    const appointment={id:"appointment-1",businessId,conversationId:conversation.id,status:AppointmentStatus.REQUESTED,createdAt:"2026-01-02",updatedAt:"2026-01-02"};
    const appointments=new PostgresAppointmentRepository(db);
    await appointments.save(appointment);
    assert.deepEqual(await appointments.findById(businessId,appointment.id),appointment);
    const handoff={id:"handoff-1",businessId,conversationId:conversation.id,reason:HandoffReason.CUSTOMER_REQUEST,summary:"handoff",status:HandoffStatus.REQUESTED,requestedAt:"2026-01-02",createdAt:"2026-01-02",updatedAt:"2026-01-02"};
    const handoffs=new PostgresHumanHandoffRepository(db);
    await handoffs.save(handoff);
    assert.deepEqual(await handoffs.findById(businessId,handoff.id),handoff);
    const commercialEvents = new PostgresCommercialEventRepository(db);
    await commercialEvents.append({id:"event-1",businessId,eventType:CommercialEventType.CONVERSATION_STARTED,conversationId:conversation.id,occurredAt:"2026-01-02"});
    assert.equal((await commercialEvents.listByBusiness(businessId)).length,1);
    const healthEvents = new PostgresAssistantHealthEventRepository(db);
    await healthEvents.append({id:"health-1",businessId,eventType:AssistantHealthEventType.AI_FAILURE,occurredAt:"2026-01-02"});
    assert.equal((await healthEvents.listByBusiness(businessId)).length,1);
    const replay = new PostgresEvolutionGoWebhookReplayGuard(db);
    const claimInput = {businessId,instanceName:"test-instance",externalMessageId:"test-message",receivedAt:"2026-01-02",claimedAt:"2026-01-02",leaseUntil:"2026-01-03",claimToken:"claim-1"};
    assert.deepEqual(await replay.claim(claimInput),{status:"claimed",claimToken:"claim-1"});
    assert.equal(await replay.complete({...claimInput}),true);
    assert.deepEqual(await replay.claim({...claimInput,claimToken:"claim-2"}),{status:"duplicate"});

    await db.query("DELETE FROM evolution_go_conversation_links WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM evolution_go_webhook_receipts WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM assistant_health_events WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM commercial_events WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM quote_requests WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM appointments WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM human_handoffs WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM opportunities WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM messages WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM conversations WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM vehicles WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM customers WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM evolution_go_conversation_links WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM conversations WHERE business_id=$1",[businessId]);
    await db.query("DELETE FROM automotive_businesses WHERE id=$1",[businessId]);
  } finally {
    await db.close();
  }
});

test("PostgreSQL runtime webhook resolves and reuses a persistent Evolution Go conversation link", { skip: !enabled }, async () => {
  const businessId=`pg-webhook-${process.pid}-${Date.now()}`;
  const instanceName="runtime-instance";
  const senderJid="5511999990000@s.whatsapp.net";
  const runtime=await createBasicPlanPostgresRuntime({
    postgres:config,
    allowInsecureLocalForTests:true,
    business:{businessId,businessName:"PostgreSQL webhook test",businessType:BusinessType.OTHER,timezone:"UTC"},
    evolutionGoWebhookCredential:{businessId,instanceName,instanceToken:"runtime-test-token"},
    interpreter:{interpret:async()=>runtimeInterpretation},
    evolutionGoTextSender:{sendText:async()=>undefined},
    now:()=>"2026-01-03T00:00:00.000Z",
  });
  try {
    await new Promise<void>((resolve,reject)=>{
      runtime.server.once("error",reject);
      runtime.server.listen(0,"127.0.0.1",resolve);
    });
    const address=runtime.server.address() as AddressInfo;
    const sendWebhook=(externalMessageId:string)=>fetch(
      `http://127.0.0.1:${address.port}/v1/channels/whatsapp/evolution-go/webhook`,
      {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        event:"Message",instanceName,instanceToken:"runtime-test-token",
        data:{Info:{ID:externalMessageId,Type:"text",Sender:senderJid,Chat:senderJid,
          Timestamp:"2026-01-03T00:00:00.000Z",IsFromMe:false,IsGroup:false},
        Message:{conversation:"runtime webhook test"}},
      })},
    );
    const first=await sendWebhook("runtime-message-1");
    const second=await sendWebhook("runtime-message-2");
    assert.equal(first.status,202);
    assert.equal(second.status,202);
    assert.equal((await first.json() as {accepted:boolean}).accepted,true);
    assert.equal((await second.json() as {accepted:boolean}).accepted,true);
    const links=await runtime.database.query<{conversation_id:string}>(
      "SELECT conversation_id FROM evolution_go_conversation_links WHERE business_id=$1 AND instance_name=$2 AND sender_jid=$3",
      [businessId,instanceName,senderJid],
    );
    const conversations=await runtime.database.query<{id:string}>(
      "SELECT id FROM conversations WHERE business_id=$1",
      [businessId],
    );
    assert.equal(links.rowCount,1);
    assert.equal(conversations.rowCount,1);
    assert.equal(links.rows[0]?.conversation_id,conversations.rows[0]?.id);
    await runtime.database.query("DELETE FROM evolution_go_webhook_receipts WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM evolution_go_webhook_claims WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM evolution_go_conversation_links WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM assistant_health_events WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM commercial_events WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM quote_requests WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM appointments WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM human_handoffs WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM opportunities WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM messages WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM conversations WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM vehicles WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM customers WHERE business_id=$1",[businessId]);
    await runtime.database.query("DELETE FROM automotive_businesses WHERE id=$1",[businessId]);
  } finally {
    await runtime.close();
  }
});
