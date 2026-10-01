import assert from "node:assert/strict";
import test from "node:test";
import type { EvolutionGoConversationLink, EvolutionGoConversationLinkRepository } from "../../src/channels/whatsapp/evolution-go-conversation-link.js";
import {
  resolveEvolutionGoConversation,
  type ResolveEvolutionGoConversationDependencies,
  type ResolveEvolutionGoConversationInput,
} from "../../src/channels/whatsapp/evolution-go-conversation-resolver.js";
import type { Conversation } from "../../src/core/domain/entities.js";
import { Channel, ConversationStatus } from "../../src/core/domain/enums.js";
import type { ConversationRepository } from "../../src/core/repositories.js";

const input: ResolveEvolutionGoConversationInput = {
  businessId: "business-synthetic",
  instanceName: "instance-synthetic",
  senderJid: "sender-synthetic@s.whatsapp.net",
};
const createdAt = "2026-03-04T05:06:07.000Z";

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conversation-existing",
    businessId: input.businessId,
    channel: Channel.WHATSAPP,
    status: ConversationStatus.ACTIVE,
    startedAt: createdAt,
    lastMessageAt: createdAt,
    ...overrides,
  };
}

function link(overrides: Partial<EvolutionGoConversationLink> = {}): EvolutionGoConversationLink {
  return {
    businessId: input.businessId,
    instanceName: input.instanceName,
    senderJid: input.senderJid,
    conversationId: "conversation-existing",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function harness(options: {
  existingLink?: EvolutionGoConversationLink | null;
  existingConversation?: Conversation | null;
} = {}) {
  const savedConversations: Conversation[] = [];
  const savedLinks: EvolutionGoConversationLink[] = [];
  const calls: string[] = [];
  let timeCalls = 0;
  let idCalls = 0;
  const conversationRepository: ConversationRepository = {
    findById: async (businessId, id) => {
      calls.push("findConversation");
      if (options.existingConversation === undefined) return null;
      const found = options.existingConversation;
      return found?.businessId === businessId && found.id === id ? found : null;
    },
    save: async (value) => { calls.push("saveConversation"); savedConversations.push(value); },
  };
  const evolutionGoConversationLinkRepository: EvolutionGoConversationLinkRepository = {
    runAtomically: async (_key, operation) => operation(),
    findBySender: async () => {
      calls.push("findLink");
      return options.existingLink ?? null;
    },
    findByConversation: async () => null,
    save: async (value) => { calls.push("saveLink"); savedLinks.push(value); },
  };
  const dependencies: ResolveEvolutionGoConversationDependencies = {
    conversationRepository,
    evolutionGoConversationLinkRepository,
    now: () => { timeCalls += 1; return `timestamp-${timeCalls}`; },
    generateId: (prefix) => { idCalls += 1; return `${prefix}-generated-${idCalls}`; },
  };
  return { dependencies, savedConversations, savedLinks, calls };
}

test("creates and links an active WhatsApp conversation when no link exists", async () => {
  const state = harness();
  const result = await resolveEvolutionGoConversation(input, state.dependencies);
  assert.equal(result.created, true);
  assert.deepEqual(result.conversation, {
    id: "conversation-generated-1",
    businessId: input.businessId,
    channel: Channel.WHATSAPP,
    status: ConversationStatus.ACTIVE,
    startedAt: "timestamp-1",
    lastMessageAt: "timestamp-1",
  });
  assert.deepEqual(state.savedConversations, [result.conversation]);
  assert.deepEqual(state.savedLinks, [{
    businessId: input.businessId,
    instanceName: input.instanceName,
    senderJid: input.senderJid,
    conversationId: result.conversation.id,
    createdAt: "timestamp-1",
    updatedAt: "timestamp-1",
  }]);
  assert.deepEqual(state.calls, ["findLink", "saveConversation", "saveLink"]);
});

test("reuses an existing active WhatsApp conversation without changing its link", async () => {
  const current = conversation();
  const state = harness({ existingLink: link(), existingConversation: current });
  const result = await resolveEvolutionGoConversation(input, state.dependencies);
  assert.deepEqual(result, { conversation: current, created: false });
  assert.deepEqual(state.calls, ["findLink", "findConversation"]);
  assert.deepEqual(state.savedConversations, []);
  assert.deepEqual(state.savedLinks, []);
});

for (const status of [ConversationStatus.WAITING_CUSTOMER, ConversationStatus.WAITING_HUMAN]) {
  test(`reuses an existing ${status} WhatsApp conversation`, async () => {
    const current = conversation({ status });
    const state = harness({ existingLink: link(), existingConversation: current });
    const result = await resolveEvolutionGoConversation(input, state.dependencies);
    assert.deepEqual(result, { conversation: current, created: false });
    assert.deepEqual(state.savedConversations, []);
    assert.deepEqual(state.savedLinks, []);
  });
}

test("creates a replacement for a closed conversation and preserves link creation time", async () => {
  const previousLink = link({ createdAt: "original-link-created", updatedAt: "original-link-updated" });
  const state = harness({
    existingLink: previousLink,
    existingConversation: conversation({ status: ConversationStatus.CLOSED }),
  });
  const result = await resolveEvolutionGoConversation(input, state.dependencies);
  assert.equal(result.created, true);
  assert.equal(result.conversation.id, "conversation-generated-1");
  assert.deepEqual(state.savedLinks, [{
    ...previousLink,
    conversationId: "conversation-generated-1",
    updatedAt: "timestamp-1",
  }]);
  assert.deepEqual(state.calls, ["findLink", "findConversation", "saveConversation", "saveLink"]);
});

test("fails safely when the link points to a missing conversation without creating a replacement", async () => {
  const state = harness({ existingLink: link(), existingConversation: null });
  await assert.rejects(resolveEvolutionGoConversation(input, state.dependencies), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(input.senderJid), false);
    assert.equal(error.message, "Unable to resolve WhatsApp conversation");
    return true;
  });
  assert.deepEqual(state.savedConversations, []);
  assert.deepEqual(state.savedLinks, []);
});

test("fails safely when the linked conversation belongs to another channel", async () => {
  const state = harness({
    existingLink: link(),
    existingConversation: conversation({ channel: Channel.WEB }),
  });
  await assert.rejects(resolveEvolutionGoConversation(input, state.dependencies), /Unable to resolve WhatsApp conversation/);
  assert.deepEqual(state.savedConversations, []);
  assert.deepEqual(state.savedLinks, []);
});

test("rejects empty input before accessing repositories", async () => {
  const state = harness();
  for (const invalidInput of [
    { ...input, businessId: " " },
    { ...input, instanceName: "" },
    { ...input, senderJid: "\t" },
  ]) {
    await assert.rejects(resolveEvolutionGoConversation(invalidInput, state.dependencies), /Unable to resolve WhatsApp conversation/);
  }
  assert.deepEqual(state.calls, []);
});
