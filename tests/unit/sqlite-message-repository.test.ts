import assert from "node:assert/strict";
import test from "node:test";
import type { AutomotiveBusiness, Conversation, Message } from "../../src/core/domain/entities.js";
import { BusinessType, Channel, ConversationStatus, SenderType } from "../../src/core/domain/enums.js";
import type { MessageRepository } from "../../src/core/repositories.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteMessageRepository } from "../../src/infrastructure/sqlite/sqlite-message-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";

const business = (id: string): AutomotiveBusiness => ({
  id,
  name: `Business ${id}`,
  businessType: BusinessType.OTHER,
  timezone: "UTC",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const conversation = (id: string, businessId: string): Conversation => ({
  id,
  businessId,
  channel: Channel.WEB,
  status: ConversationStatus.ACTIVE,
  startedAt: "2026-01-01T00:00:00.000Z",
  lastMessageAt: "2026-01-01T00:00:00.000Z",
});

const message = (
  id: string,
  businessId: string,
  conversationId: string,
  createdAt: string,
  overrides: Partial<Message> = {},
): Message => ({
  id,
  businessId,
  conversationId,
  senderType: SenderType.CUSTOMER,
  channel: Channel.WEB,
  content: `Content ${id}`,
  externalMessageId: `external-${id}`,
  createdAt,
  ...overrides,
});

const withRepositories = async (
  run: (
    repository: SqliteMessageRepository,
    businesses: SqliteAutomotiveBusinessRepository,
    conversations: SqliteConversationRepository,
    database: ReturnType<typeof createSqliteDatabase>,
  ) => Promise<void>,
) => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await run(
      new SqliteMessageRepository(database),
      new SqliteAutomotiveBusinessRepository(database),
      new SqliteConversationRepository(database),
      database,
    );
  } finally {
    database.close();
  }
};

const seedConversation = async (
  businesses: SqliteAutomotiveBusinessRepository,
  conversations: SqliteConversationRepository,
  businessId: string,
  conversationId: string,
) => {
  await businesses.save(business(businessId));
  await conversations.save(conversation(conversationId, businessId));
};

test("satisfies MessageRepository and saves every field", async () => {
  await withRepositories(async (repository, businesses, conversations) => {
    const contract: MessageRepository = repository;
    await seedConversation(businesses, conversations, "business-a", "conversation-a");
    const entity = message("message-1", "business-a", "conversation-a", "2026-01-02T00:00:00.000Z");
    await contract.save(entity);
    assert.deepEqual(await contract.listByConversation(entity.businessId, entity.conversationId), [entity]);
  });
});

test("lists only the requested business and conversation", async () => {
  await withRepositories(async (repository, businesses, conversations) => {
    await seedConversation(businesses, conversations, "business-a", "conversation-a");
    await seedConversation(businesses, conversations, "business-a", "conversation-b");
    await seedConversation(businesses, conversations, "business-b", "conversation-a");
    const expected = message("expected", "business-a", "conversation-a", "2026-01-02T00:00:00.000Z");
    await repository.save(expected);
    await repository.save(message("other-conversation", "business-a", "conversation-b", expected.createdAt));
    await repository.save(message("other-business", "business-b", "conversation-a", expected.createdAt));

    assert.deepEqual(await repository.listByConversation("business-a", "conversation-a"), [expected]);
    assert.deepEqual(await repository.listByConversation("business-b", "conversation-a"), [
      message("other-business", "business-b", "conversation-a", expected.createdAt),
    ]);
  });
});

test("orders messages by created_at and then id", async () => {
  await withRepositories(async (repository, businesses, conversations) => {
    await seedConversation(businesses, conversations, "business-a", "conversation-a");
    const later = message("z-later", "business-a", "conversation-a", "2026-01-03T00:00:00.000Z");
    const tieB = message("b-tie", "business-a", "conversation-a", "2026-01-02T00:00:00.000Z");
    const tieA = message("a-tie", "business-a", "conversation-a", "2026-01-02T00:00:00.000Z");
    const earlier = message("earlier", "business-a", "conversation-a", "2026-01-01T00:00:00.000Z");
    for (const entity of [later, tieB, tieA, earlier]) await repository.save(entity);

    assert.deepEqual(
      await repository.listByConversation("business-a", "conversation-a"),
      [earlier, tieA, tieB, later],
    );
  });
});

test("externalMessageId null is omitted and sender/channel enums round-trip", async () => {
  await withRepositories(async (repository, businesses, conversations, database) => {
    await seedConversation(businesses, conversations, "business-a", "conversation-a");
    const entity: Message = {
      id: "message-1",
      businessId: "business-a",
      conversationId: "conversation-a",
      senderType: SenderType.HUMAN_AGENT,
      channel: Channel.WHATSAPP,
      content: "Resposta humana",
      createdAt: "2026-01-02T00:00:00.000Z",
    };
    await repository.save(entity);
    const stored = database.prepare(
      "SELECT external_message_id FROM messages WHERE business_id = ? AND id = ?",
    ).get(entity.businessId, entity.id);
    assert.deepEqual(stored && { ...stored }, { external_message_id: null });
    assert.deepEqual(await repository.listByConversation(entity.businessId, entity.conversationId), [entity]);
  });
});

test("invalid SenderType or Channel fails with a stable load error", async (t) => {
  for (const [column, value] of [["sender_type", "INVALID_SENDER"], ["channel", "INVALID_CHANNEL"]] as const) {
    await t.test(column, async () => {
      await withRepositories(async (repository, businesses, conversations, database) => {
        await seedConversation(businesses, conversations, "business-a", "conversation-a");
        const entity = message("message-1", "business-a", "conversation-a", "2026-01-02T00:00:00.000Z");
        await repository.save(entity);
        database.prepare(`UPDATE messages SET ${column} = ? WHERE business_id = ? AND id = ?`)
          .run(value, entity.businessId, entity.id);
        await assert.rejects(repository.listByConversation(entity.businessId, entity.conversationId), {
          message: "Failed to load Message",
        });
      });
    });
  }
});

test("foreign keys reject missing or cross-business conversation references", async (t) => {
  await t.test("missing Conversation", async () => {
    await withRepositories(async (repository, businesses) => {
      await businesses.save(business("business-a"));
      await assert.rejects(
        repository.save(message("message-1", "business-a", "missing", "2026-01-02T00:00:00.000Z")),
        { message: "Failed to save Message" },
      );
    });
  });

  await t.test("Conversation from another business", async () => {
    await withRepositories(async (repository, businesses, conversations) => {
      await businesses.save(business("business-a"));
      await seedConversation(businesses, conversations, "business-b", "conversation-b");
      await assert.rejects(
        repository.save(message("message-1", "business-a", "conversation-b", "2026-01-02T00:00:00.000Z")),
        { message: "Failed to save Message" },
      );
    });
  });
});
