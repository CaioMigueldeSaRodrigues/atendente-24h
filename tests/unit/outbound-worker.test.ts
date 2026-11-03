import assert from "node:assert/strict";
import test from "node:test";
import { Channel, ConversationStatus, HandoffReason, HandoffStatus, OutboundDeliveryStatus, SenderType } from "../../src/core/domain/enums.js";
import type { HumanHandoff, OutboundDelivery } from "../../src/core/domain/entities.js";
import { STALE_HANDOFF_REPLY } from "../../src/core/human-handoff-service.js";
import { InMemoryConversationRepository, InMemoryCustomerRepository, InMemoryHumanHandoffRepository, InMemoryMessageRepository, InMemoryOutboundDeliveryRepository } from "../../src/core/in-memory-repositories.js";
import { OutboundWorker, type ExpiredChannelClaim, type OutboundWorkerDependencies, type PendingChannelReply } from "../../src/core/outbound-worker.js";

const businessId = "business-a";
const baseDelivery: OutboundDelivery = {
  id: "delivery-1",
  businessId,
  messageId: "message-1",
  quoteRequestId: "quote-1",
  conversationId: "conversation-1",
  channel: Channel.WHATSAPP,
  recipientRef: "5511999990000@s.whatsapp.net",
  status: OutboundDeliveryStatus.FAILED_RETRYABLE,
  attempts: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const baseReply: PendingChannelReply = {
  businessId,
  instanceName: "instance-a",
  externalMessageId: "external-1",
  conversationId: "conversation-1",
  senderJid: "5511888880000@s.whatsapp.net",
  reply: "Resposta persistida",
  attempts: 0,
};

const scope = { businessId, instanceName: "instance-a" };
const expiredClaim: ExpiredChannelClaim = { ...scope, externalMessageId: "external-2", receivedAt: "2026-01-01T00:00:00.000Z", conversationId: "conversation-1", senderJid: "5511777770000@s.whatsapp.net", content: "Oi" };

async function createHarness(options: { fail: boolean; pendingReply?: PendingChannelReply; delivery?: OutboundDelivery | null; expiredClaims?: ExpiredChannelClaim[]; recovered?: PendingChannelReply | null; handoffs?: HumanHandoff[] }) {
  let now = "2026-01-02T00:00:00.000Z";
  let sequence = 0;
  const repository = new InMemoryOutboundDeliveryRepository();
  if (options.delivery !== null) await repository.create(options.delivery ?? baseDelivery);
  const sent: Array<{ recipientJid: string; content: string }> = [];
  const replyState = { reply: options.pendingReply, claims: [] as string[], allowClaim: true, failed: 0, sentCalls: [] as Array<{ providerMessageId?: string }> };
  const scopes: unknown[] = [];
  const failedBefore: string[] = [];
  const recovered: ExpiredChannelClaim[] = [];
  const closeCalls: Array<{ businessId: string; channel: string; idleBefore: string; closedAt: string }> = [];
  const humanHandoffRepository = new InMemoryHumanHandoffRepository();
  const handoffConversations = new InMemoryConversationRepository();
  const handoffMessages = new InMemoryMessageRepository();
  const events: string[] = [];
  await handoffConversations.save({ id: baseDelivery.conversationId, businessId, channel: Channel.WHATSAPP, status: ConversationStatus.ACTIVE, startedAt: baseDelivery.createdAt, lastMessageAt: baseDelivery.createdAt });
  for (const handoff of options.handoffs ?? []) {
    await humanHandoffRepository.save(handoff);
    await handoffConversations.save({ id: handoff.conversationId, businessId, channel: Channel.WHATSAPP, status: ConversationStatus.WAITING_HUMAN, startedAt: handoff.requestedAt, lastMessageAt: handoff.requestedAt });
  }
  const dependencies: OutboundWorkerDependencies = {
    scope,
    channel: Channel.WHATSAPP,
    claims: {
      listExpiredClaims: async (received) => { scopes.push(received); return recovered.length === 0 ? options.expiredClaims ?? [] : []; },
      recover: async (claim) => { recovered.push(claim); return options.recovered ?? null; },
    },
    deliveries: {
      listDue: async (received) => {
        scopes.push(received);
        const delivery = await repository.findById(businessId, baseDelivery.id);
        return delivery && delivery.status !== OutboundDeliveryStatus.DELIVERED && delivery.status !== OutboundDeliveryStatus.FAILED_FINAL ? [delivery] : [];
      },
      claimForSending: repository.claimForSending.bind(repository),
      markDelivered: repository.markDelivered.bind(repository),
      markFailed: repository.markFailed.bind(repository),
    },
    replies: {
      listDueReplies: async (received) => { scopes.push(received); return replyState.reply ? [replyState.reply] : []; },
      failRepliesReceivedBefore: async (received, before) => { scopes.push(received); failedBefore.push(before); },
      claimReplyRetry: async (reply, nextRetryAt) => {
        replyState.claims.push(nextRetryAt);
        if (replyState.allowClaim) replyState.reply = { ...reply, attempts: reply.attempts + 1 };
        return replyState.allowClaim;
      },
      markReplyFailed: async () => { replyState.failed += 1; replyState.reply = undefined; },
      markSent: async (input) => { replyState.sentCalls.push(input); replyState.reply = undefined; return true; },
    },
    conversations: { closeIdle: async (closeBusinessId, channel, idleBefore, closedAt) => { closeCalls.push({ businessId: closeBusinessId, channel, idleBefore, closedAt }); return 0; } },
    messageRepository: {
      listByConversation: async () => [{
        id: "message-1", businessId, conversationId: "conversation-1", senderType: SenderType.ASSISTANT,
        channel: Channel.WHATSAPP, content: "Orçamento persistido", createdAt: "2026-01-01T00:00:00.000Z",
      }],
    },
    handoffs: { humanHandoffRepository, conversationRepository: handoffConversations, messageRepository: handoffMessages, customerRepository: new InMemoryCustomerRepository() },
    resolveRecipient: async () => "resolved@s.whatsapp.net",
    sender: {
      sendText: async (message) => {
        sent.push(message);
        if (options.fail) throw new Error("synthetic sender failure");
        return { providerMessageId: "provider-1" };
      },
    },
    now: () => now,
    generateId: (prefix) => `${prefix}-${++sequence}`,
    onSendFailed: () => events.push("send failed"),
    onHandoffOpened: (openedBusinessId) => events.push(`handoff opened ${openedBusinessId}`),
  };
  return {
    events,
    worker: new OutboundWorker(dependencies),
    scopes,
    failedBefore,
    closeCalls,
    recovered,
    repository,
    sent,
    replyState,
    humanHandoffRepository,
    handoffConversations,
    handoffMessages,
    advanceToNextAttempt: async () => {
      const delivery = await repository.findById(businessId, baseDelivery.id);
      now = delivery!.nextAttemptAt!;
    },
    get now() { return now; },
  };
}

test("resends a due delivery with the persisted message and marks it delivered", async () => {
  const harness = await createHarness({ fail: false });
  await harness.worker.runOnce();
  assert.deepEqual(harness.sent, [{ recipientJid: baseDelivery.recipientRef, content: "Orçamento persistido" }]);
  const delivery = await harness.repository.findById(businessId, baseDelivery.id);
  assert.equal(delivery?.status, OutboundDeliveryStatus.DELIVERED);
  assert.equal(delivery?.providerMessageId, "provider-1");
});

test("backs off 1, 5, 30 and 120 minutes and gives up after 6 attempts", async () => {
  const harness = await createHarness({ fail: true });
  const delays: number[] = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const before = Date.parse(harness.now);
    await harness.worker.runOnce();
    const delivery = await harness.repository.findById(businessId, baseDelivery.id);
    assert.equal(delivery?.status, OutboundDeliveryStatus.FAILED_RETRYABLE);
    assert.equal(delivery?.attempts, attempt);
    delays.push((Date.parse(delivery!.nextAttemptAt!) - before) / 60_000);
    await harness.advanceToNextAttempt();
  }
  assert.deepEqual(delays, [1, 5, 30, 120, 120]);
  await harness.worker.runOnce();
  const delivery = await harness.repository.findById(businessId, baseDelivery.id);
  assert.equal(delivery?.status, OutboundDeliveryStatus.FAILED_FINAL);
  assert.equal(delivery?.attempts, 6);
  assert.equal(JSON.stringify(delivery).includes("synthetic"), false);
  await harness.worker.runOnce();
  assert.equal(harness.sent.length, 6);
  assert.equal(harness.events.filter((event) => event === "send failed").length, 6);
  await assertHandedOffOnce(harness);
});

async function assertHandedOffOnce(harness: Awaited<ReturnType<typeof createHarness>>) {
  assert.deepEqual((await harness.humanHandoffRepository.listOpen(businessId)).map(({ conversationId, reason }) => [conversationId, reason]), [["conversation-1", HandoffReason.INTEGRATION_FAILURE]]);
  const conversation = await harness.handoffConversations.findById(businessId, "conversation-1");
  assert.equal(conversation?.status, ConversationStatus.WAITING_HUMAN);
  assert.equal(harness.events.filter((event) => event === `handoff opened ${businessId}`).length, 1);
}

test("finalizes a delivery that has no message or recipient without calling the sender", async () => {
  const { recipientRef: _recipient, ...withoutRecipient } = baseDelivery;
  const harness = await createHarness({ fail: false, delivery: { ...withoutRecipient, messageId: "unknown-message" } });
  await harness.worker.runOnce();
  assert.equal((await harness.repository.findById(businessId, baseDelivery.id))?.status, OutboundDeliveryStatus.FAILED_FINAL);
  assert.equal(harness.sent.length, 0);
  await assertHandedOffOnce(harness);
});

test("resends a processed reply once and records the provider id", async () => {
  const harness = await createHarness({ fail: false, pendingReply: baseReply, delivery: null });
  await harness.worker.runOnce();
  await harness.worker.runOnce();
  assert.deepEqual(harness.sent, [{ recipientJid: baseReply.senderJid, content: baseReply.reply }]);
  assert.equal(harness.replyState.sentCalls.length, 1);
  assert.equal(harness.replyState.sentCalls[0]!.providerMessageId, "provider-1");
});

test("skips a reply another worker already claimed", async () => {
  const harness = await createHarness({ fail: false, pendingReply: baseReply, delivery: null });
  harness.replyState.allowClaim = false;
  await harness.worker.runOnce();
  assert.equal(harness.sent.length, 0);
});

test("a reply keeps the backoff and is abandoned after 6 attempts", async () => {
  const harness = await createHarness({ fail: true, pendingReply: baseReply, delivery: null });
  for (let attempt = 1; attempt <= 6; attempt += 1) await harness.worker.runOnce();
  assert.equal(harness.replyState.failed, 1);
  assert.equal(harness.sent.length, 6);
  assert.deepEqual(
    harness.replyState.claims.map((at) => (Date.parse(at) - Date.parse(harness.now)) / 60_000),
    [1, 5, 30, 120, 120, 120],
  );
  assert.equal(harness.events.filter((event) => event === "send failed").length, 6);
  await assertHandedOffOnce(harness);
});

test("a send that fails and recovers opens no handoff", async () => {
  const harness = await createHarness({ fail: true, pendingReply: baseReply, delivery: null });
  await harness.worker.runOnce();
  assert.deepEqual(harness.events, ["send failed"]);
  assert.deepEqual(await harness.humanHandoffRepository.listOpen(businessId), []);
});

test("every query is scoped and old replies are abandoned after 24 hours", async () => {
  const harness = await createHarness({ fail: false });
  await harness.worker.runOnce();
  assert.equal(harness.scopes.length, 4);
  for (const received of harness.scopes) assert.deepEqual(received, scope);
  assert.deepEqual(harness.failedBefore, ["2026-01-01T00:00:00.000Z"]);
});

test("a recovered claim gets its fixed reply sent once", async () => {
  const reply: PendingChannelReply = { ...baseReply, externalMessageId: "external-2", senderJid: expiredClaim.senderJid, reply: "Texto fixo" };
  const harness = await createHarness({ fail: false, delivery: null, expiredClaims: [expiredClaim], recovered: reply });
  await harness.worker.runOnce();
  await harness.worker.runOnce();
  assert.deepEqual(harness.recovered, [expiredClaim]);
  assert.deepEqual(harness.sent, [{ recipientJid: expiredClaim.senderJid, content: "Texto fixo" }]);
  assert.equal(harness.replyState.sentCalls.length, 1);
});

test("a claim taken by someone else sends nothing", async () => {
  const harness = await createHarness({ fail: false, delivery: null, expiredClaims: [expiredClaim], recovered: null });
  await harness.worker.runOnce();
  assert.equal(harness.recovered.length, 1);
  assert.equal(harness.sent.length, 0);
});

test("every cycle closes the conversations idle for 24 hours, only for its own business and channel", async () => {
  const harness = await createHarness({ fail: false, delivery: null });
  await harness.worker.runOnce();
  assert.deepEqual(harness.closeCalls, [{
    businessId,
    channel: Channel.WHATSAPP,
    idleBefore: "2026-01-01T00:00:00.000Z",
    closedAt: "2026-01-02T00:00:00.000Z",
  }]);
});

const handoff = (id: string, requestedAt: string, status: HandoffStatus = HandoffStatus.REQUESTED): HumanHandoff =>
  ({ id, businessId, conversationId: `conversation-${id}`, reason: HandoffReason.CUSTOMER_REQUEST, summary: "Quero uma pessoa", status, requestedAt, createdAt: requestedAt, updatedAt: requestedAt });

test("a handoff nobody took for 12 hours is resolved, the conversation goes back to the bot and the customer is asked once to repeat", async () => {
  // The worker's clock is 2026-01-02T00:00Z: the first handoff is 37 hours old, the second 11 hours old.
  const harness = await createHarness({ fail: false, delivery: null, handoffs: [handoff("old", "2025-12-31T11:00:00.000Z"), handoff("fresh", "2026-01-01T13:00:00.000Z")] });
  await harness.worker.runOnce();
  await harness.worker.runOnce();
  assert.deepEqual(harness.sent, [{ recipientJid: "resolved@s.whatsapp.net", content: STALE_HANDOFF_REPLY }]);
  assert.equal((await harness.humanHandoffRepository.findById(businessId, "old"))?.status, HandoffStatus.RESOLVED);
  assert.equal((await harness.handoffConversations.findById(businessId, "conversation-old"))?.status, ConversationStatus.ACTIVE);
  assert.deepEqual((await harness.handoffMessages.listByConversation(businessId, "conversation-old")).map(({ senderType, content }) => [senderType, content]), [[SenderType.ASSISTANT, STALE_HANDOFF_REPLY]]);
  assert.equal((await harness.humanHandoffRepository.findById(businessId, "fresh"))?.status, HandoffStatus.REQUESTED);
  assert.equal((await harness.handoffConversations.findById(businessId, "conversation-fresh"))?.status, ConversationStatus.WAITING_HUMAN);
});

test("a handoff exactly at the 12 hour edge waits, and one a person accepted waits for 24 hours of silence", async () => {
  // The clock is 2026-01-02T00:00Z: "taken" is exactly 24 hours old, "quiet" is older.
  const harness = await createHarness({ fail: false, delivery: null, handoffs: [
    handoff("edge", "2026-01-01T12:00:00.000Z"),
    { ...handoff("taken", "2025-12-30T00:00:00.000Z", HandoffStatus.ACCEPTED), acceptedAt: "2026-01-01T00:00:00.000Z" },
    { ...handoff("quiet", "2025-12-30T00:00:00.000Z", HandoffStatus.ACCEPTED), acceptedAt: "2025-12-31T23:59:59.000Z" },
  ] });
  await harness.worker.runOnce();
  await harness.worker.runOnce();
  assert.deepEqual(harness.sent, [{ recipientJid: "resolved@s.whatsapp.net", content: STALE_HANDOFF_REPLY }]);
  assert.equal((await harness.humanHandoffRepository.findById(businessId, "quiet"))?.status, HandoffStatus.RESOLVED);
  assert.equal((await harness.handoffConversations.findById(businessId, "conversation-quiet"))?.status, ConversationStatus.ACTIVE);
  assert.equal((await harness.humanHandoffRepository.findById(businessId, "edge"))?.status, HandoffStatus.REQUESTED);
  assert.equal((await harness.humanHandoffRepository.findById(businessId, "taken"))?.status, HandoffStatus.ACCEPTED);
});

test("when the stale handoff text cannot be sent the handoff is still resolved and nothing is stored or retried", async () => {
  const harness = await createHarness({ fail: true, delivery: null, handoffs: [handoff("old", "2025-12-31T11:00:00.000Z")] });
  await harness.worker.runOnce();
  assert.equal((await harness.humanHandoffRepository.findById(businessId, "old"))?.status, HandoffStatus.RESOLVED);
  assert.equal((await harness.handoffConversations.findById(businessId, "conversation-old"))?.status, ConversationStatus.ACTIVE);
  assert.deepEqual(await harness.handoffMessages.listByConversation(businessId, "conversation-old"), []);
  const attempts = harness.sent.length;
  await harness.worker.runOnce();
  assert.equal(harness.sent.length, attempts);
});
