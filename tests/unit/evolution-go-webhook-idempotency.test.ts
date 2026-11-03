import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { BusinessType, ConversationStatus, HandoffReason, Intent, SenderType } from "../../src/core/domain/enums.js";
import type { EvolutionGoWebhookReplayGuard } from "../../src/channels/whatsapp/evolution-go-webhook-replay-guard.js";
import { createBasicPlanHttpServer } from "../../src/infrastructure/http/basic-plan-http-server.js";
import { InMemoryAppointmentRepository, InMemoryHumanHandoffRepository } from "../../src/core/in-memory-repositories.js";
import type { HumanHandoff } from "../../src/core/domain/entities.js";
import { LLM_FAILURE_REPLY } from "../../src/core/response-policy.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteCustomerRepository } from "../../src/infrastructure/sqlite/sqlite-customer-repository.js";
import { SqliteEvolutionGoConversationLinkRepository } from "../../src/infrastructure/sqlite/sqlite-evolution-go-conversation-link-repository.js";
import { SqliteEvolutionGoWebhookReplayGuard } from "../../src/infrastructure/sqlite/sqlite-evolution-go-webhook-replay-guard.js";
import { SqliteMessageRepository } from "../../src/infrastructure/sqlite/sqlite-message-repository.js";
import { SqliteOpportunityRepository } from "../../src/infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteQuoteRequestRepository } from "../../src/infrastructure/sqlite/sqlite-quote-request-repository.js";
import { SqliteVehicleRepository } from "../../src/infrastructure/sqlite/sqlite-vehicle-repository.js";
import { SqliteOutboundDeliveryRepository } from "../../src/infrastructure/sqlite/sqlite-outbound-delivery-repository.js";
import { withSqliteTransaction } from "../../src/infrastructure/sqlite/sqlite-connection-lock.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";

const businessId = "idempotency-business";
const credential = {
  businessId,
  instanceName: "idempotency-instance",
  instanceToken: "synthetic-token",
};
const interpretation: AIInterpretation = {
  intent: Intent.GENERAL_INFORMATION,
  extractedCustomerData: {},
  extractedVehicleData: {},
  missingData: [],
  suggestedNextAction: { type: "NONE", description: "Nenhuma ação adicional" },
  requiresHuman: false,
  proposedResponse: "Resposta idempotente",
};

type HarnessOptions = {
  interpret: (content: string, call: number) => Promise<AIInterpretation>;
  replayGuard?: EvolutionGoWebhookReplayGuard;
  database?: ReturnType<typeof createSqliteDatabase>;
  sendText?: (message: { recipientJid: string; content: string }) => Promise<void>;
};

async function createHarness(options: HarnessOptions) {
  const database = options.database ?? createSqliteDatabase({ filename: ":memory:" });
  await new SqliteAutomotiveBusinessRepository(database).save({
    id: businessId,
    name: "Idempotency Test",
    businessType: BusinessType.OTHER,
    timezone: "UTC",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  let sequence = 0;
  let calls = 0;
  const sent: Array<{ recipientJid: string; content: string }> = [];
  const handoffs: HumanHandoff[] = [];
  const humanHandoffRepository = new InMemoryHumanHandoffRepository();
  const saveHandoff = humanHandoffRepository.save.bind(humanHandoffRepository);
  humanHandoffRepository.save = async (entity) => { handoffs.push(entity); await saveHandoff(entity); };
  const replayGuard = options.replayGuard ?? new SqliteEvolutionGoWebhookReplayGuard(database);
  const server = createBasicPlanHttpServer({
    conversationRepository: new SqliteConversationRepository(database),
    messageRepository: new SqliteMessageRepository(database),
    customerRepository: new SqliteCustomerRepository(database),
    vehicleRepository: new SqliteVehicleRepository(database),
    opportunityRepository: new SqliteOpportunityRepository(database),
    quoteRequestRepository: new SqliteQuoteRequestRepository(database),
    outboundDeliveryRepository: new SqliteOutboundDeliveryRepository(database),
    appointmentRepository: new InMemoryAppointmentRepository(),
    humanHandoffRepository,
    evolutionGoWebhookCredentials: [credential],
    evolutionGoWebhookReplayGuard: replayGuard,
    evolutionGoConversationLinkRepository: new SqliteEvolutionGoConversationLinkRepository(database),
    evolutionGoTextSender: {
      sendText: async (message) => {
        sent.push(message);
        await options.sendText?.(message);
      },
    },
    evolutionGoWebhookTransaction: {
      run: <T>(operation: () => Promise<T>) => withSqliteTransaction(database, operation),
    },
    operator: { businessId, businessName: "Idempotency Test" },
    businessOperatorAuthorizer: { isAuthorized: async (input) => input.businessId === businessId },
    interpreter: {
      interpret: async (input: { content: string }) => {
        calls += 1;
        return options.interpret(input.content, calls);
      },
    },
    now: () => "2026-01-02T00:00:00.000Z",
    generateId: (prefix) => `${prefix}-${++sequence}`,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const post = (externalMessageId: string, content: string) => fetch(
    `http://127.0.0.1:${address.port}/v1/channels/whatsapp/evolution-go/webhook`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "Message",
        instanceName: credential.instanceName,
        instanceToken: credential.instanceToken,
        data: {
          Info: {
            ID: externalMessageId,
            Type: "text",
            IsFromMe: false,
            IsGroup: false,
            Sender: "5511999990000@s.whatsapp.net",
            Timestamp: "2026-01-02T00:00:00.000Z",
          },
          Message: { conversation: content },
        },
      }),
    },
  );
  const postReceipt = (providerMessageId: string, status = "Delivered", instanceToken = credential.instanceToken) => fetch(
    `http://127.0.0.1:${address.port}/v1/channels/whatsapp/evolution-go/webhook`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "Receipt",
        instanceName: credential.instanceName,
        instanceToken,
        state: status,
        data: { MessageIDs: [providerMessageId], Type: status === "Delivered" ? "" : "read", Timestamp: "2026-01-02T00:00:00.000Z", Chat: "masked@s.whatsapp.net" },
      }),
    },
  );
  return {
    database,
    server,
    post,
    postReceipt,
    sent,
    handoffs,
    get calls() { return calls; },
    async messages() {
      const link = await new SqliteEvolutionGoConversationLinkRepository(database)
        .findBySender(businessId, credential.instanceName, "5511999990000@s.whatsapp.net");
      return link === null ? [] : new SqliteMessageRepository(database)
        .listByConversation(businessId, link.conversationId);
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    },
  };
}

test("Receipt webhook keeps authentication and replay idempotency", async () => {
  const harness = await createHarness({ interpret: async () => interpretation });
  try {
    assert.equal((await harness.postReceipt("provider-receipt-1", "Delivered", "invalid-token")).status, 401);
    assert.equal((await harness.postReceipt("provider-receipt-1")).status, 202);
    assert.equal((await harness.postReceipt("provider-receipt-1")).status, 202);
    assert.equal(harness.database.prepare("SELECT COUNT(*) AS count FROM evolution_go_delivery_receipts").get()?.count, 1);
  } finally {
    await harness.close();
  }
});

test("LLM failure keeps the customer message, answers with fixed text and opens one AI_FAILURE handoff; the next message waits for the person", async () => {
  const harness = await createHarness({
    interpret: async () => { throw new Error("synthetic interpreter failure"); },
  });
  try {
    assert.equal((await harness.post("message-llm-down", "failure-after-effect")).status, 202);
    assert.equal((await harness.post("message-llm-down", "failure-after-effect")).status, 202);
    assert.equal((await harness.post("message-llm-down-2", "second failure")).status, 202);
    // The conversation is with a person now: the second message is stored, not interpreted and not answered.
    assert.equal(harness.calls, 1);
    const messages = await harness.messages();
    assert.deepEqual(messages.map(({ senderType, content }) => [senderType, content]), [
      [SenderType.CUSTOMER, "failure-after-effect"],
      [SenderType.ASSISTANT, LLM_FAILURE_REPLY],
      [SenderType.CUSTOMER, "second failure"],
    ]);
    assert.deepEqual(harness.sent.map(({ content }) => content), [LLM_FAILURE_REPLY]);
    assert.deepEqual(harness.handoffs.map(({ reason, summary }) => [reason, summary]), [[HandoffReason.AI_FAILURE, "failure-after-effect"]]);
    const conversation = await new SqliteConversationRepository(harness.database).findById(businessId, messages[0]!.conversationId);
    assert.equal(conversation?.status, ConversationStatus.WAITING_HUMAN);
  } finally {
    await harness.close();
  }
});

test("apply failure keeps one customer message and rolls the assistant reply back for the retry", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  await new SqliteAutomotiveBusinessRepository(database).save({
    id: businessId, name: "Idempotency Test", businessType: BusinessType.OTHER, timezone: "UTC",
    active: true, createdAt: "2026-01-01", updatedAt: "2026-01-01",
  });
  const base = new SqliteEvolutionGoWebhookReplayGuard(database);
  let fail = true;
  const replayGuard: EvolutionGoWebhookReplayGuard = {
    claim: base.claim.bind(base),
    lockForProcessing: base.lockForProcessing.bind(base),
    markProcessed: async (input) => {
      if (fail) { fail = false; throw new Error("synthetic markProcessed failure"); }
      return base.markProcessed(input);
    },
    markSent: base.markSent.bind(base),
    applyProviderReceipt: base.applyProviderReceipt.bind(base),
    complete: base.complete.bind(base),
    release: base.release.bind(base),
    expireLease: base.expireLease.bind(base),
  };
  const harness = await createHarness({ database, replayGuard, interpret: async () => interpretation });
  try {
    assert.equal((await harness.post("message-before-processed", "failure-before-processed")).status, 500);
    assert.equal((await harness.post("message-before-processed", "failure-before-processed")).status, 202);
    assert.equal(harness.calls, 2);
    assert.deepEqual((await harness.messages()).map(({ senderType }) => senderType), [SenderType.CUSTOMER, SenderType.ASSISTANT]);
    assert.equal(harness.sent.length, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM evolution_go_webhook_claims").get()?.count, 0);
  } finally {
    await harness.close();
  }
});

test("messages of one sender are interpreted in parallel and applied one at a time", async () => {
  const release: Array<() => void> = [];
  const harness = await createHarness({
    interpret: async () => {
      await new Promise<void>((resolve) => { release.push(resolve); });
      return interpretation;
    },
  });
  try {
    const first = harness.post("parallel-message-1", "primeira");
    while (release.length < 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const second = harness.post("parallel-message-2", "segunda");
    while (release.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual((await harness.messages()).map(({ content }) => content), ["primeira", "segunda"]);
    release[1]!();
    assert.equal((await second).status, 202);
    release[0]!();
    assert.equal((await first).status, 202);
    assert.equal((await harness.messages()).length, 4);
    assert.equal(harness.sent.length, 2);
  } finally {
    await harness.close();
  }
});

test("concurrent duplicate webhooks execute processMessage once", async () => {
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const harness = await createHarness({
    interpret: async (_content, call) => {
      if (call === 1) {
        entered();
        await releasePromise;
      }
      return interpretation;
    },
  });
  try {
    const first = harness.post("concurrent-message", "concurrent");
    await enteredPromise;
    const second = harness.post("concurrent-message", "concurrent");
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(harness.calls, 1);
    release();
    assert.equal((await first).status, 202);
    assert.ok([202, 503].includes((await second).status));
    assert.equal(harness.calls, 1);
  } finally {
    release();
    await harness.close();
  }
});

test("sender failure reuses the persisted reply without reprocessing", async () => {
  let fail = true;
  const harness = await createHarness({
    interpret: async () => interpretation,
    sendText: async () => {
      if (fail) { fail = false; throw new Error("synthetic sender failure"); }
    },
  });
  try {
    assert.equal((await harness.post("sender-failure", "sender-failure")).status, 503);
    assert.equal((await harness.post("sender-failure", "sender-failure")).status, 202);
    assert.equal(harness.calls, 1);
    assert.equal(harness.sent.length, 2);
  } finally {
    await harness.close();
  }
});

test("successful webhook commits processing before sending", async () => {
  const harness = await createHarness({ interpret: async () => interpretation });
  try {
    assert.equal((await harness.post("successful-message", "successful")).status, 202);
    assert.equal(harness.calls, 1);
    assert.deepEqual(harness.sent, [{
      recipientJid: "5511999990000@s.whatsapp.net",
      content: interpretation.proposedResponse,
    }]);
  } finally {
    await harness.close();
  }
});

test("an apply failure keeps the claim of the saved message with an expired lease", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  await new SqliteAutomotiveBusinessRepository(database).save({
    id: businessId, name: "Idempotency Test", businessType: BusinessType.OTHER, timezone: "UTC",
    active: true, createdAt: "2026-01-01", updatedAt: "2026-01-01",
  });
  const base = new SqliteEvolutionGoWebhookReplayGuard(database);
  const replayGuard: EvolutionGoWebhookReplayGuard = {
    claim: base.claim.bind(base),
    lockForProcessing: base.lockForProcessing.bind(base),
    markProcessed: async () => { throw new Error("synthetic apply failure"); },
    markSent: base.markSent.bind(base),
    applyProviderReceipt: base.applyProviderReceipt.bind(base),
    complete: base.complete.bind(base),
    release: base.release.bind(base),
    expireLease: base.expireLease.bind(base),
  };
  const harness = await createHarness({ database, replayGuard, interpret: async () => interpretation });
  try {
    assert.equal((await harness.post("message-apply-failure", "apply failure")).status, 500);
    assert.deepEqual(
      database.prepare("SELECT external_message_id, lease_until FROM evolution_go_webhook_claims").all().map((row) => ({ ...row })),
      [{ external_message_id: "message-apply-failure", lease_until: "2026-01-02T00:00:00.000Z" }],
    );
    assert.deepEqual((await harness.messages()).map(({ senderType }) => senderType), [SenderType.CUSTOMER]);
  } finally {
    await harness.close();
  }
});
