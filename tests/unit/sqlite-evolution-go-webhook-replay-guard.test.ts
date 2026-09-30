import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BusinessType } from "../../src/core/domain/enums.js";
import type { AutomotiveBusiness } from "../../src/core/domain/entities.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";
import { SqliteEvolutionGoWebhookReplayGuard } from "../../src/infrastructure/sqlite/sqlite-evolution-go-webhook-replay-guard.js";

const business = (id: string): AutomotiveBusiness => ({
  id,
  name: `Empresa ${id}`,
  businessType: BusinessType.OTHER,
  timezone: "UTC",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const input = (overrides: Partial<{
  businessId: string;
  instanceName: string;
  externalMessageId: string;
  receivedAt: string;
  claimedAt: string;
  leaseUntil: string;
  claimToken: string;
}> = {}) => ({
  businessId: "business-a",
  instanceName: "instance-a",
  externalMessageId: "message-synthetic-1",
  receivedAt: "2026-01-02T03:04:05.000Z",
  claimedAt: "2026-01-02T03:04:05.000Z",
  leaseUntil: "2026-01-02T03:09:05.000Z",
  claimToken: "internal-claim-synthetic-1",
  ...overrides,
});

async function addBusinesses(database: ReturnType<typeof createSqliteDatabase>) {
  const businesses = new SqliteAutomotiveBusinessRepository(database);
  await businesses.save(business("business-a"));
  await businesses.save(business("business-b"));
}

test("claims, leases, takeover and completion enforce the current owner", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await addBusinesses(database);
    const guard = new SqliteEvolutionGoWebhookReplayGuard(database);
    const first = input();
    assert.deepEqual(guard.claim(first), { status: "claimed", claimToken: first.claimToken });

    const second = input({
      receivedAt: "2026-01-02T03:06:05.000Z",
      claimedAt: "2026-01-02T03:06:05.000Z",
      leaseUntil: "2026-01-02T03:11:05.000Z",
      claimToken: "internal-claim-synthetic-2",
    });
    assert.deepEqual(guard.claim(second), { status: "in_progress" });

    const takeover = input({
      receivedAt: "2026-01-02T03:10:05.000Z",
      claimedAt: "2026-01-02T03:10:05.000Z",
      leaseUntil: "2026-01-02T03:15:05.000Z",
      claimToken: "internal-claim-synthetic-3",
    });
    assert.deepEqual(guard.claim(takeover), { status: "claimed", claimToken: takeover.claimToken });

    const oldKey = {
      businessId: first.businessId,
      instanceName: first.instanceName,
      externalMessageId: first.externalMessageId,
      claimToken: first.claimToken,
    };
    assert.equal(guard.complete(oldKey), false);
    assert.equal(guard.release(oldKey), false);

    const currentKey = { ...oldKey, claimToken: takeover.claimToken };
    assert.equal(guard.complete(currentKey), true);
    assert.equal(guard.complete(currentKey), false);
    assert.deepEqual(guard.claim(input({ claimToken: "claim-after-completion" })), { status: "duplicate" });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM evolution_go_webhook_claims").get()?.count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM evolution_go_webhook_receipts").get()?.count, 1);
  } finally {
    database.close();
  }
});

test("completed receipts remain duplicates after reopening the database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "evolution-go-replay-"));
  const filename = join(directory, "receipts.db");
  let database = createSqliteDatabase({ filename });
  try {
    await addBusinesses(database);
    const guard = new SqliteEvolutionGoWebhookReplayGuard(database);
    const attempt = input();
    const result = guard.claim(attempt);
    assert.equal(result.status, "claimed");
    assert.equal(guard.complete({ ...attempt }), true);
    database.close();

    database = createSqliteDatabase({ filename });
    assert.deepEqual(
      new SqliteEvolutionGoWebhookReplayGuard(database).claim(attempt),
      { status: "duplicate" },
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("processed receipts preserve the reply for a send retry", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await addBusinesses(database);
    const guard = new SqliteEvolutionGoWebhookReplayGuard(database);
    const attempt = input();
    assert.deepEqual(guard.claim(attempt), { status: "claimed", claimToken: attempt.claimToken });
    const key = {
      businessId: attempt.businessId,
      instanceName: attempt.instanceName,
      externalMessageId: attempt.externalMessageId,
      claimToken: attempt.claimToken,
    };
    assert.equal(await guard.markProcessed({
      ...key,
      conversationId: "conversation-1",
      senderJid: "sender@example.invalid",
      reply: "reply synthetic",
    }), true);
    assert.deepEqual(guard.claim(input({ claimToken: "retry-claim" })), {
      status: "processed",
      processed: {
        conversationId: "conversation-1",
        senderJid: "sender@example.invalid",
        reply: "reply synthetic",
      },
    });
    assert.equal(guard.markSent({
      businessId: attempt.businessId,
      instanceName: attempt.instanceName,
      externalMessageId: attempt.externalMessageId,
      sentAt: "2026-01-02T03:05:00.000Z",
    }), true);
    assert.deepEqual(guard.claim(input({ claimToken: "after-sent" })), { status: "duplicate" });
  } finally {
    database.close();
  }
});

test("release only removes the current claim and permits an immediate retry", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await addBusinesses(database);
    const guard = new SqliteEvolutionGoWebhookReplayGuard(database);
    const attempt = input();
    assert.equal(guard.claim(attempt).status, "claimed");
    const key = {
      businessId: attempt.businessId,
      instanceName: attempt.instanceName,
      externalMessageId: attempt.externalMessageId,
      claimToken: attempt.claimToken,
    };
    assert.equal(guard.release({ ...key, claimToken: "old-token" }), false);
    assert.equal(guard.release(key), true);
    const retry = input({ claimToken: "retry-claim-token" });
    assert.deepEqual(guard.claim(retry), { status: "claimed", claimToken: retry.claimToken });
  } finally {
    database.close();
  }
});

test("claim and receipt keys remain isolated by business and instance", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await addBusinesses(database);
    const guard = new SqliteEvolutionGoWebhookReplayGuard(database);
    const attempt = input();
    assert.equal(guard.claim(attempt).status, "claimed");
    assert.equal(guard.complete({ ...attempt }), true);
    assert.deepEqual(guard.claim(input({ instanceName: "instance-b" })), {
      status: "claimed", claimToken: "internal-claim-synthetic-1",
    });
    assert.deepEqual(guard.claim(input({ businessId: "business-b" })), {
      status: "claimed", claimToken: "internal-claim-synthetic-1",
    });
  } finally {
    database.close();
  }
});

test("temporary and final records contain no credentials or message content", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await addBusinesses(database);
    const guard = new SqliteEvolutionGoWebhookReplayGuard(database);
    const attempt = input();
    assert.equal(guard.claim(attempt).status, "claimed");

    const claimRows = database.prepare("SELECT * FROM evolution_go_webhook_claims").all();
    assert.deepEqual(Object.keys(claimRows[0] ?? {}).sort(), [
      "business_id", "claim_token", "claimed_at", "external_message_id",
      "instance_name", "lease_until", "received_at",
    ]);
    assert.equal(JSON.stringify(claimRows).includes("fake-instance-token"), false);
    assert.equal(JSON.stringify(claimRows).includes("synthetic message content"), false);
    assert.equal(JSON.stringify(claimRows).includes("sender@example.invalid"), false);
    assert.equal(guard.complete({ ...attempt }), true);

    const receipts = database.prepare("SELECT * FROM evolution_go_webhook_receipts").all();
    assert.deepEqual(Object.keys(receipts[0] ?? {}).sort(), [
      "business_id", "conversation_id", "external_message_id", "instance_name", "received_at",
      "reply", "sender_jid", "sent_at", "status",
    ]);
    assert.equal(JSON.stringify(receipts).includes(attempt.claimToken), false);
    assert.equal(JSON.stringify(receipts).includes("fake-instance-token"), false);
    assert.equal(JSON.stringify(receipts).includes("synthetic message content"), false);
    assert.equal(JSON.stringify(receipts).includes("sender@example.invalid"), false);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM evolution_go_webhook_claims").get()?.count, 0);
  } finally {
    database.close();
  }
});
