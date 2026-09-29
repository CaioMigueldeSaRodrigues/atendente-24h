import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveEvolutionGoConversation } from "../../src/channels/whatsapp/evolution-go-conversation-resolver.js";
import type { Conversation } from "../../src/core/domain/entities.js";
import { Channel, ConversationStatus } from "../../src/core/domain/enums.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";
import { SqliteEvolutionGoConversationLinkRepository } from "../../src/infrastructure/sqlite/sqlite-evolution-go-conversation-link-repository.js";

const fixedTime = "2026-04-05T06:07:08.000Z";

async function withSqlite(run: (state: SqliteState) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "evolution-go-resolver-"));
  const filename = join(directory, "resolver.db");
  const database = createSqliteDatabase({ filename });
  const conversationRepository = new SqliteConversationRepository(database);
  const linkRepository = new SqliteEvolutionGoConversationLinkRepository(database);
  let id = 0;
  try {
    for (const businessId of ["business-a", "business-b", "business-process"]) {
      database.prepare(`
        INSERT INTO automotive_businesses (
          id, name, business_type, timezone, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(businessId, businessId, "OTHER", "UTC", 1, fixedTime, fixedTime);
    }
    await run({
      database,
      filename,
      conversationRepository,
      linkRepository,
      resolve: (businessId = "business-a", instanceName = "instance-a", senderJid = "sender-a@synthetic.invalid") =>
        resolveEvolutionGoConversation({ businessId, instanceName, senderJid }, {
          conversationRepository,
          evolutionGoConversationLinkRepository: linkRepository,
          now: () => fixedTime,
          generateId: (prefix) => `${prefix}-sqlite-${++id}`,
        }),
    });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

interface SqliteState {
  database: ReturnType<typeof createSqliteDatabase>;
  filename: string;
  conversationRepository: SqliteConversationRepository;
  linkRepository: SqliteEvolutionGoConversationLinkRepository;
  resolve: (businessId?: string, instanceName?: string, senderJid?: string) => ReturnType<typeof resolveEvolutionGoConversation>;
}

function conversation(id: string, businessId = "business-a", status = ConversationStatus.ACTIVE): Conversation {
  return {
    id,
    businessId,
    channel: Channel.WHATSAPP,
    status,
    startedAt: fixedTime,
    lastMessageAt: fixedTime,
  };
}

function count(database: ReturnType<typeof createSqliteDatabase>, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function waitForWorkerMessage(child: ChildProcess, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown) => {
      if (typeof message === "object" && message !== null && "type" in message && message.type === type) {
        child.off("message", onMessage);
        resolve(message as Record<string, unknown>);
      }
    };
    child.on("message", onMessage);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(`SQLite resolver worker exited unexpectedly (${code})`));
    });
  });
}

function startWorker(filename: string, role: "holder" | "resolver"): ChildProcess {
  const workerPath = join(__dirname, "fixtures", "sqlite-evolution-go-conversation-resolver-worker.js");
  return fork(workerPath, [], {
    env: { ...process.env, RESOLVER_DB_FILE: filename, RESOLVER_WORKER_ROLE: role },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
}

function waitForWorkerExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("SQLite resolver worker exited unexpectedly")));
  });
}

test("simultaneous resolutions without a link persist only one conversation and link", async () => {
  await withSqlite(async ({ database, resolve }) => {
    const results = await Promise.all([resolve(), resolve()]);
    assert.equal(results[0]?.conversation.id, results[1]?.conversation.id);
    assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
    assert.equal(count(database, "conversations"), 1);
    assert.equal(count(database, "evolution_go_conversation_links"), 1);
    const persistedLink = database.prepare("SELECT conversation_id FROM evolution_go_conversation_links").get() as { conversation_id: string };
    assert.equal(persistedLink.conversation_id, results[0]?.conversation.id);
  });
});

test("simultaneous resolutions replace a closed conversation only once", async () => {
  await withSqlite(async ({ database, conversationRepository, linkRepository, resolve }) => {
    const old = conversation("closed-conversation", "business-a", ConversationStatus.CLOSED);
    await conversationRepository.save(old);
    await linkRepository.save({
      businessId: "business-a",
      instanceName: "instance-a",
      senderJid: "sender-a@synthetic.invalid",
      conversationId: old.id,
      createdAt: "original-created",
      updatedAt: "original-updated",
    });
    const results = await Promise.all([resolve(), resolve()]);
    assert.equal(results[0]?.conversation.id, results[1]?.conversation.id);
    assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
    assert.equal(count(database, "conversations"), 2);
    assert.equal(count(database, "evolution_go_conversation_links"), 1);
    const persistedLink = database.prepare("SELECT * FROM evolution_go_conversation_links").get() as {
      conversation_id: string; created_at: string; updated_at: string;
    };
    assert.equal(persistedLink.conversation_id, results[0]?.conversation.id);
    assert.equal(persistedLink.created_at, "original-created");
    assert.equal(persistedLink.updated_at, fixedTime);
  });
});

test("conversation insert failure leaves no link or conversation", async () => {
  await withSqlite(async ({ database, resolve }) => {
    database.exec(`
      CREATE TRIGGER fail_conversation_insert BEFORE INSERT ON conversations
      BEGIN SELECT RAISE(ABORT, 'synthetic insert failure'); END;
    `);
    await assert.rejects(resolve(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Unable to resolve WhatsApp conversation");
      assert.equal((error.cause as Error).message, "Conversation persistence failed");
      return true;
    });
    assert.equal(count(database, "conversations"), 0);
    assert.equal(count(database, "evolution_go_conversation_links"), 0);
  });
});

test("link insert failure rolls back conversation and a retry persists one consistent pair", async () => {
  await withSqlite(async ({ database, resolve }) => {
    database.exec(`
      CREATE TRIGGER fail_link_insert BEFORE INSERT ON evolution_go_conversation_links
      BEGIN SELECT RAISE(ABORT, 'synthetic link failure'); END;
    `);
    await assert.rejects(resolve(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Unable to resolve WhatsApp conversation");
      assert.equal((error.cause as Error).message, "Conversation link persistence failed");
      assert.equal(error.message.includes("sender-a"), false);
      return true;
    });
    assert.equal(count(database, "conversations"), 0);
    assert.equal(count(database, "evolution_go_conversation_links"), 0);

    database.exec("DROP TRIGGER fail_link_insert");
    const result = await resolve();
    assert.equal(result.created, true);
    assert.equal(count(database, "conversations"), 1);
    assert.equal(count(database, "evolution_go_conversation_links"), 1);
    const persistedLink = database.prepare("SELECT conversation_id FROM evolution_go_conversation_links").get() as { conversation_id: string };
    assert.equal(persistedLink.conversation_id, result.conversation.id);
  });
});

test("same sender is isolated across businesses and instances", async () => {
  await withSqlite(async ({ database, resolve }) => {
    const results = await Promise.all([
      resolve("business-a", "instance-a", "same@synthetic.invalid"),
      resolve("business-a", "instance-b", "same@synthetic.invalid"),
      resolve("business-b", "instance-a", "same@synthetic.invalid"),
    ]);
    assert.equal(new Set(results.map((result) => result.conversation.id)).size, 3);
    assert.equal(count(database, "conversations"), 3);
    assert.equal(count(database, "evolution_go_conversation_links"), 3);
    const stored = database.prepare(`
      SELECT business_id, instance_name, conversation_id
      FROM evolution_go_conversation_links ORDER BY business_id, instance_name
    `).all().map((row) => ({ ...row }));
    assert.deepEqual(stored, [
      { business_id: "business-a", instance_name: "instance-a", conversation_id: results[0]?.conversation.id },
      { business_id: "business-a", instance_name: "instance-b", conversation_id: results[1]?.conversation.id },
      { business_id: "business-b", instance_name: "instance-a", conversation_id: results[2]?.conversation.id },
    ]);
  });
});

test("other repositories sharing the connection wait until the transaction finishes", async () => {
  await withSqlite(async ({ linkRepository, conversationRepository }) => {
    let announceStarted!: () => void;
    let releaseTransaction!: () => void;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseTransaction = resolve; });
    const transaction = linkRepository.runAtomically({
      businessId: "business-a",
      instanceName: "instance-a",
      senderJid: "sender-a@synthetic.invalid",
    }, async () => {
      announceStarted();
      await gate;
    });
    await started;
    let lookupFinished = false;
    const lookup = conversationRepository.findById("business-a", "absent")
      .then((value) => { lookupFinished = true; return value; });
    assert.equal(lookupFinished, false);
    releaseTransaction();
    await Promise.all([transaction, lookup]);
    assert.equal(lookupFinished, true);
  });
});

test("independent processes serialize resolution against the same SQLite file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "evolution-go-process-resolver-"));
  const filename = join(directory, "resolver.db");
  const initialDatabase = createSqliteDatabase({ filename });
  initialDatabase.prepare(`
    INSERT INTO automotive_businesses (
      id, name, business_type, timezone, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("business-process", "business-process", "OTHER", "UTC", 1, fixedTime, fixedTime);
  initialDatabase.close();

  const holder = startWorker(filename, "holder");
  const resolver = startWorker(filename, "resolver");
  let verificationDatabase: ReturnType<typeof createSqliteDatabase> | undefined;
  try {
    const holderReady = waitForWorkerMessage(holder, "ready");
    const resolverReady = waitForWorkerMessage(resolver, "ready");
    await Promise.all([holderReady, resolverReady]);

    const held = waitForWorkerMessage(holder, "transaction-held");
    holder.send({ type: "acquire" });
    await held;

    const resolving = waitForWorkerMessage(resolver, "resolving");
    resolver.send({ type: "resolve" });
    await resolving;

    const holderResolved = waitForWorkerMessage(holder, "resolved");
    const resolverResolved = waitForWorkerMessage(resolver, "resolved");
    const released = waitForWorkerMessage(holder, "released");
    const holderExit = waitForWorkerExit(holder);
    const resolverExit = waitForWorkerExit(resolver);
    holder.send({ type: "release" });
    const [holderResult, resolverResult] = await Promise.all([
      holderResolved, resolverResolved, released, holderExit, resolverExit,
    ]);
    assert.equal(holderResult.conversationId, resolverResult.conversationId);

    verificationDatabase = createSqliteDatabase({ filename });
    const rows = verificationDatabase.prepare(
      "SELECT id FROM conversations WHERE business_id = ?",
    ).all("business-process");
    assert.equal(rows.length, 1);
    assert.equal(count(verificationDatabase, "evolution_go_conversation_links"), 1);
    const storedLink = verificationDatabase.prepare(`
      SELECT conversation_id FROM evolution_go_conversation_links
      WHERE business_id = ? AND instance_name = ? AND sender_jid = ?
    `).get("business-process", "instance-process", "sender-process@synthetic.invalid") as { conversation_id: string };
    assert.equal(storedLink.conversation_id, holderResult.conversationId);
  } finally {
    if (holder.exitCode === null) holder.kill();
    if (resolver.exitCode === null) resolver.kill();
    verificationDatabase?.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    verificationDatabase?.exec("PRAGMA journal_mode = DELETE");
    verificationDatabase?.close();
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EPERM") throw error;
    }
  }
});
