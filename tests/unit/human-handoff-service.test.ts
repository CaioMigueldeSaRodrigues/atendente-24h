import assert from "node:assert/strict";
import test from "node:test";
import type { Conversation, HumanHandoff } from "../../src/core/domain/entities.js";
import { Channel, ConversationStatus, HandoffReason, HandoffStatus, SenderType } from "../../src/core/domain/enums.js";
import {
  HumanHandoffError, STALE_HANDOFF_REPLY, assignHandoff, listOpenHandoffs, replyToHandoff, resolveHandoff, resolveStaleHandoffs, type HumanHandoffServiceDependencies,
} from "../../src/core/human-handoff-service.js";
import { InMemoryBusinessProfileRepository, InMemoryConversationRepository, InMemoryCustomerRepository, InMemoryHumanHandoffRepository, InMemoryMessageRepository } from "../../src/core/in-memory-repositories.js";

const at = "2026-01-01T12:00:00.000Z";
const conversation: Conversation = { id: "conversation-1", businessId: "business-a", customerId: "customer-1", channel: Channel.WHATSAPP, status: ConversationStatus.WAITING_HUMAN, startedAt: at, lastMessageAt: at };
const handoff: HumanHandoff = { id: "handoff-1", businessId: "business-a", conversationId: "conversation-1", reason: HandoffReason.CUSTOMER_REQUEST, summary: "Quero uma pessoa", status: HandoffStatus.REQUESTED, requestedAt: at, createdAt: at, updatedAt: at };

async function createHarness(options: { sendFails?: boolean } = {}) {
  const humanHandoffRepository = new InMemoryHumanHandoffRepository();
  const conversationRepository = new InMemoryConversationRepository();
  const messageRepository = new InMemoryMessageRepository();
  const customerRepository = new InMemoryCustomerRepository();
  const sent: string[] = [];
  let sequence = 0;
  await humanHandoffRepository.save(handoff);
  await conversationRepository.save(conversation);
  await customerRepository.save({ id: "customer-1", businessId: "business-a", name: "Maria", primaryPhone: "5592999990000", createdAt: at, updatedAt: at });
  await messageRepository.save({ id: "message-0", businessId: "business-a", conversationId: "conversation-1", senderType: SenderType.CUSTOMER, channel: Channel.WHATSAPP, content: "Quero uma pessoa", createdAt: at });
  const dependencies: HumanHandoffServiceDependencies = {
    humanHandoffRepository, conversationRepository, messageRepository, customerRepository,
    sendToCustomer: async (_conversation, content) => { if (options.sendFails) throw new Error("synthetic channel failure"); sent.push(content); },
    now: () => "2026-01-01T12:30:00.000Z",
    generateId: (prefix) => `${prefix}-${++sequence}`,
  };
  return { dependencies, humanHandoffRepository, conversationRepository, messageRepository, sent };
}

test("the queue shows the open handoff with the customer, the full phone, the summary and the messages", async () => {
  const { dependencies } = await createHarness();
  const [item] = await listOpenHandoffs("business-a", dependencies);
  assert.equal(item?.id, "handoff-1");
  assert.deepEqual(item?.customer, { name: "Maria", phone: "5592999990000" });
  assert.equal(item?.summary, "Quero uma pessoa");
  assert.deepEqual(item?.messages.map(({ content }) => content), ["Quero uma pessoa"]);
  assert.deepEqual(await listOpenHandoffs("business-b", dependencies), []);
});

test("assigning takes the handoff once and keeps the first acceptance", async () => {
  const { dependencies, humanHandoffRepository } = await createHarness();
  const accepted = await assignHandoff("business-a", "handoff-1", dependencies);
  assert.equal(accepted.status, HandoffStatus.ACCEPTED);
  assert.equal(accepted.acceptedAt, "2026-01-01T12:30:00.000Z");
  assert.equal((await assignHandoff("business-a", "handoff-1", { ...dependencies, now: () => "2026-01-01T13:00:00.000Z" })).acceptedAt, "2026-01-01T12:30:00.000Z");
  assert.equal((await humanHandoffRepository.findById("business-a", "handoff-1"))?.status, HandoffStatus.ACCEPTED);
});

test("a reply is stored as the person's, sent to the customer and takes the handoff", async () => {
  const { dependencies, humanHandoffRepository, messageRepository, conversationRepository, sent } = await createHarness();
  const message = await replyToHandoff("business-a", "handoff-1", "  Já vou olhar o seu carro.  ", dependencies);
  assert.deepEqual(sent, ["Já vou olhar o seu carro."]);
  const stored = (await messageRepository.listByConversation("business-a", "conversation-1")).find(({ id }) => id === message.id);
  assert.equal(stored?.senderType, SenderType.HUMAN_AGENT);
  assert.equal(stored?.content, "Já vou olhar o seu carro.");
  assert.equal((await humanHandoffRepository.findById("business-a", "handoff-1"))?.status, HandoffStatus.ACCEPTED);
  assert.equal((await conversationRepository.findById("business-a", "conversation-1"))?.lastMessageAt, "2026-01-01T12:30:00.000Z");
});

test("a failed send is reported and nothing is written: no message, no assignment, no new activity", async () => {
  const { dependencies, messageRepository, humanHandoffRepository, conversationRepository } = await createHarness({ sendFails: true });
  await assert.rejects(replyToHandoff("business-a", "handoff-1", "Texto que não foi entregue", dependencies), (error) => error instanceof HumanHandoffError && error.code === "SEND_FAILED");
  assert.deepEqual((await messageRepository.listByConversation("business-a", "conversation-1")).map(({ content }) => content), ["Quero uma pessoa"]);
  assert.equal((await humanHandoffRepository.findById("business-a", "handoff-1"))?.status, HandoffStatus.REQUESTED);
  assert.equal((await conversationRepository.findById("business-a", "conversation-1"))?.lastMessageAt, at);
});

test("an empty or oversized reply is refused before anything is stored", async () => {
  const { dependencies, messageRepository } = await createHarness();
  for (const content of ["   ", "", "x".repeat(4001), 42, undefined]) {
    await assert.rejects(replyToHandoff("business-a", "handoff-1", content, dependencies), (error) => error instanceof HumanHandoffError && error.code === "INVALID_CONTENT");
  }
  assert.equal((await messageRepository.listByConversation("business-a", "conversation-1")).length, 1);
});

test("resolving gives the conversation back to the bot and closes every open handoff of it", async () => {
  const { dependencies, humanHandoffRepository, conversationRepository } = await createHarness();
  await humanHandoffRepository.save({ ...handoff, id: "handoff-duplicate", requestedAt: "2026-01-01T12:10:00.000Z" });
  const resolved = await resolveHandoff("business-a", "handoff-1", dependencies);
  assert.equal(resolved.status, HandoffStatus.RESOLVED);
  assert.deepEqual(await humanHandoffRepository.listOpen("business-a"), []);
  const returned = await conversationRepository.findById("business-a", "conversation-1");
  assert.equal(returned?.status, ConversationStatus.ACTIVE);
  assert.equal(returned?.lastMessageAt, "2026-01-01T12:30:00.000Z");
  await assert.rejects(resolveHandoff("business-a", "handoff-1", dependencies), (error) => error instanceof HumanHandoffError && error.code === "HANDOFF_NOT_OPEN");
  await assert.rejects(replyToHandoff("business-a", "handoff-1", "Tarde demais", dependencies), (error) => error instanceof HumanHandoffError && error.code === "HANDOFF_NOT_OPEN");
});

test("a handoff of another business is not found, whatever the action", async () => {
  const { dependencies, sent } = await createHarness();
  for (const action of [
    () => assignHandoff("business-b", "handoff-1", dependencies),
    () => replyToHandoff("business-b", "handoff-1", "Oi", dependencies),
    () => resolveHandoff("business-b", "handoff-1", dependencies),
  ]) {
    await assert.rejects(action(), (error) => error instanceof HumanHandoffError && error.code === "HANDOFF_NOT_FOUND");
  }
  assert.deepEqual(sent, []);
});

const staleBefore = "2026-01-01T12:29:00.000Z";
const takenStaleBefore = "2026-01-01T12:20:00.000Z";
const accepted = (acceptedAt: string): HumanHandoff => ({ ...handoff, status: HandoffStatus.ACCEPTED, assignedTo: "operador", acceptedAt });
const personReply = (createdAt: string) => ({ id: "message-person", businessId: "business-a", conversationId: "conversation-1", senderType: SenderType.HUMAN_AGENT, channel: Channel.WHATSAPP, content: "Já vejo", createdAt });

test("a taken handoff with no word from the person for the taken limit goes back to the bot, like the untaken one", async () => {
  const { dependencies, humanHandoffRepository, conversationRepository, sent } = await createHarness();
  await humanHandoffRepository.save(accepted("2026-01-01T12:10:00.000Z"));

  assert.equal(await resolveStaleHandoffs("business-a", Channel.WHATSAPP, staleBefore, takenStaleBefore, dependencies), 1);

  assert.deepEqual(sent, [STALE_HANDOFF_REPLY]);
  assert.equal((await humanHandoffRepository.findById("business-a", "handoff-1"))?.status, HandoffStatus.RESOLVED);
  assert.equal((await conversationRepository.findById("business-a", "conversation-1"))?.status, ConversationStatus.ACTIVE);
});

test("the taken limit counts from the last human message, and the acceptance itself counts as activity", async () => {
  const recentAccept = await createHarness();
  await recentAccept.humanHandoffRepository.save(accepted("2026-01-01T12:25:00.000Z"));
  assert.equal(await resolveStaleHandoffs("business-a", Channel.WHATSAPP, staleBefore, takenStaleBefore, recentAccept.dependencies), 0);

  const recentReply = await createHarness();
  await recentReply.humanHandoffRepository.save(accepted("2026-01-01T12:05:00.000Z"));
  await recentReply.messageRepository.save(personReply("2026-01-01T12:25:00.000Z"));
  assert.equal(await resolveStaleHandoffs("business-a", Channel.WHATSAPP, staleBefore, takenStaleBefore, recentReply.dependencies), 0);
  assert.deepEqual(recentReply.sent, []);
  assert.equal((await recentReply.humanHandoffRepository.findById("business-a", "handoff-1"))?.status, HandoffStatus.ACCEPTED);
});

test("a handoff of the other queue in a taken conversation waits for the person, not for the 12 hours", async () => {
  const { dependencies, humanHandoffRepository, sent } = await createHarness();
  await humanHandoffRepository.save(accepted("2026-01-01T12:25:00.000Z"));
  await humanHandoffRepository.save({ ...handoff, id: "handoff-duplicate" });
  assert.equal(await resolveStaleHandoffs("business-a", Channel.WHATSAPP, staleBefore, takenStaleBefore, dependencies), 0);
  assert.deepEqual(sent, []);
});

test("the stale text goes out only while the workshop is open; without hours it goes out normally", async () => {
  const friday = { 5: [{ open: "08:00", close: "18:00" }] };
  const withHours = async (openingHours: Record<number, Array<{ open: string; close: string }>>, now: string) => {
    const harness = await createHarness();
    const businessProfileRepository = new InMemoryBusinessProfileRepository();
    await businessProfileRepository.save({ businessId: "business-a", openingHours, services: [], paymentMethods: [], updatedAt: at });
    const resolved = await resolveStaleHandoffs("business-a", Channel.WHATSAPP, "2026-01-03T00:00:00.000Z", takenStaleBefore, {
      ...harness.dependencies,
      businessProfileRepository,
      businessRepository: { findById: async () => ({ timezone: "America/Manaus" }) as never },
      now: () => now,
    });
    return { resolved, harness };
  };

  // 2026-01-02 is a Friday; 12:00Z is 08:00 in Manaus and 11:59Z is 07:59, still closed.
  const closed = await withHours(friday, "2026-01-02T11:59:00.000Z");
  assert.equal(closed.resolved, 0);
  assert.deepEqual(closed.harness.sent, []);
  assert.equal((await closed.harness.humanHandoffRepository.findById("business-a", "handoff-1"))?.status, HandoffStatus.REQUESTED);

  const open = await withHours(friday, "2026-01-02T12:00:00.000Z");
  assert.equal(open.resolved, 1);
  assert.deepEqual(open.harness.sent, [STALE_HANDOFF_REPLY]);

  const noHours = await withHours({}, "2026-01-02T03:00:00.000Z");
  assert.equal(noHours.resolved, 1);
  assert.deepEqual(noHours.harness.sent, [STALE_HANDOFF_REPLY]);
});
