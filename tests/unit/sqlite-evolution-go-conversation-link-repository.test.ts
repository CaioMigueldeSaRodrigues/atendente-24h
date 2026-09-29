import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EvolutionGoConversationLink } from "../../src/channels/whatsapp/evolution-go-conversation-link.js";
import { Channel, ConversationStatus } from "../../src/core/domain/enums.js";
import type { Conversation } from "../../src/core/domain/entities.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";
import { SqliteEvolutionGoConversationLinkRepository } from "../../src/infrastructure/sqlite/sqlite-evolution-go-conversation-link-repository.js";

const business = (database: ReturnType<typeof createSqliteDatabase>, id: string) => {
  database.prepare(`
    INSERT INTO automotive_businesses (
      id, name, business_type, timezone, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, `Empresa ${id}`, "OTHER", "UTC", 1, "created", "updated");
};

async function addConversation(
  database: ReturnType<typeof createSqliteDatabase>,
  businessId: string,
  id: string,
): Promise<void> {
  const conversation: Conversation = {
    id,
    businessId,
    channel: Channel.WHATSAPP,
    status: ConversationStatus.ACTIVE,
    startedAt: "2026-01-01T00:00:00.000Z",
    lastMessageAt: "2026-01-01T00:00:00.000Z",
  };
  await new SqliteConversationRepository(database).save(conversation);
}

function link(overrides: Partial<EvolutionGoConversationLink> = {}): EvolutionGoConversationLink {
  return {
    businessId: "business-a",
    instanceName: "instance-a",
    senderJid: "sender-a@s.whatsapp.net",
    conversationId: "conversation-a",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function withDatabase(
  run: (repository: SqliteEvolutionGoConversationLinkRepository, database: ReturnType<typeof createSqliteDatabase>) => Promise<void>,
) {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    business(database, "business-a");
    business(database, "business-b");
    await addConversation(database, "business-a", "conversation-a");
    await addConversation(database, "business-a", "conversation-b");
    await addConversation(database, "business-b", "conversation-a");
    await run(new SqliteEvolutionGoConversationLinkRepository(database), database);
  } finally {
    database.close();
  }
}

test("creates the link table with no credential or message content columns", async () => {
  await withDatabase(async (_repository, database) => {
    const columns = database.prepare(
      "PRAGMA table_info(evolution_go_conversation_links)",
    ).all().map((column) => (column as { name: string }).name).sort();
    assert.deepEqual(columns, [
      "business_id", "conversation_id", "created_at", "instance_name", "sender_jid", "updated_at",
    ]);
  });
});

test("saves and finds a sender link and returns null when it is absent", async () => {
  await withDatabase(async (repository) => {
    assert.equal(await repository.findBySender("business-a", "instance-a", "sender-a@s.whatsapp.net"), null);
    const value = link();
    await repository.save(value);
    assert.deepEqual(await repository.findBySender(value.businessId, value.instanceName, value.senderJid), value);
  });
});

test("isolates lookups by business, instance and sender JID", async () => {
  await withDatabase(async (repository) => {
    const value = link();
    await repository.save(value);
    assert.equal(await repository.findBySender("business-b", value.instanceName, value.senderJid), null);
    assert.equal(await repository.findBySender(value.businessId, "instance-b", value.senderJid), null);
    assert.equal(await repository.findBySender(value.businessId, value.instanceName, "other@s.whatsapp.net"), null);
  });
});

test("upsert changes conversation and updatedAt while preserving createdAt", async () => {
  await withDatabase(async (repository) => {
    const original = link();
    await repository.save(original);
    await repository.save(link({
      conversationId: "conversation-b",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
    }));
    assert.deepEqual(await repository.findBySender(
      original.businessId, original.instanceName, original.senderJid,
    ), {
      ...original,
      conversationId: "conversation-b",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
  });
});

test("persists links after reopening a SQLite file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "evolution-go-links-"));
  const filename = join(directory, "links.db");
  let database = createSqliteDatabase({ filename });
  try {
    business(database, "business-a");
    await addConversation(database, "business-a", "conversation-a");
    const repository = new SqliteEvolutionGoConversationLinkRepository(database);
    const value = link();
    await repository.save(value);
    database.close();
    database = createSqliteDatabase({ filename });
    assert.deepEqual(await new SqliteEvolutionGoConversationLinkRepository(database).findBySender(
      value.businessId, value.instanceName, value.senderJid,
    ), value);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("foreign keys reject missing and cross-business conversations", async () => {
  await withDatabase(async (repository) => {
    await assert.rejects(repository.save(link({ conversationId: "missing" })), /Failed to save/);
    await assert.rejects(repository.save(link({
      businessId: "business-b",
      conversationId: "conversation-b",
    })), /Failed to save/);
  });
});
