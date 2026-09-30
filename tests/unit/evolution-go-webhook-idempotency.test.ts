import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { BusinessType, Intent, SenderType } from "../../src/core/domain/enums.js";
import type { EvolutionGoWebhookReplayGuard } from "../../src/channels/whatsapp/evolution-go-webhook-replay-guard.js";
import { createBasicPlanHttpServer } from "../../src/infrastructure/http/basic-plan-http-server.js";
import { InMemoryAppointmentRepository, InMemoryHumanHandoffRepository } from "../../src/core/in-memory-repositories.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteCustomerRepository } from "../../src/infrastructure/sqlite/sqlite-customer-repository.js";
import { SqliteEvolutionGoConversationLinkRepository } from "../../src/infrastructure/sqlite/sqlite-evolution-go-conversation-link-repository.js";
import { SqliteEvolutionGoWebhookReplayGuard } from "../../src/infrastructure/sqlite/sqlite-evolution-go-webhook-replay-guard.js";
import { SqliteMessageRepository } from "../../src/infrastructure/sqlite/sqlite-message-repository.js";
import { SqliteOpportunityRepository } from "../../src/infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteQuoteRequestRepository } from "../../src/infrastructure/sqlite/sqlite-quote-request-repository.js";
import { SqliteVehicleRepository } from "../../src/infrastructure/sqlite/sqlite-vehicle-repository.js";
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
  const replayGuard = options.replayGuard ?? new SqliteEvolutionGoWebhookReplayGuard(database);
  const server = createBasicPlanHttpServer({
    conversationRepository: new SqliteConversationRepository(database),
    messageRepository: new SqliteMessageRepository(database),
    customerRepository: new SqliteCustomerRepository(database),
    vehicleRepository: new SqliteVehicleRepository(database),
    opportunityRepository: new SqliteOpportunityRepository(database),
    quoteRequestRepository: new SqliteQuoteRequestRepository(database),
    appointmentRepository: new InMemoryAppointmentRepository(),
    humanHandoffRepository: new InMemoryHumanHandoffRepository(),
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
  return {
    database,
    server,
    post,
    sent,
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

test("rolls back effects when processMessage fails after a persistent effect", async () => {
  const harness = await createHarness({
    interpret: async (_content, call) => {
      if (call === 1) throw new Error("synthetic interpreter failure");
      return interpretation;
    },
  });
  try {
    assert.equal((await harness.post("message-after-effect", "failure-after-effect")).status, 500);
    assert.equal((await harness.post("message-after-effect", "failure-after-effect")).status, 202);
    assert.equal(harness.calls, 2);
    const messages = await harness.messages();
    assert.deepEqual(messages.map(({ senderType }) => senderType), [SenderType.CUSTOMER, SenderType.ASSISTANT]);
  } finally {
    await harness.close();
  }
});

test("rolls back effects when markProcessed fails and retries processMessage once", async () => {
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
    complete: base.complete.bind(base),
    release: base.release.bind(base),
  };
  const harness = await createHarness({ database, replayGuard, interpret: async () => interpretation });
  try {
    assert.equal((await harness.post("message-before-processed", "failure-before-processed")).status, 500);
    assert.equal((await harness.post("message-before-processed", "failure-before-processed")).status, 202);
    assert.equal(harness.calls, 2);
    assert.deepEqual((await harness.messages()).map(({ senderType }) => senderType), [SenderType.CUSTOMER, SenderType.ASSISTANT]);
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
