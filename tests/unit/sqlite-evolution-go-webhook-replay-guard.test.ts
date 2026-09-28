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

test("claims receipts once per business, instance and message and persists them", async () => {
  const directory = mkdtempSync(join(tmpdir(), "evolution-go-replay-"));
  const filename = join(directory, "receipts.db");
  let database = createSqliteDatabase({ filename });

  try {
    const businesses = new SqliteAutomotiveBusinessRepository(database);
    await businesses.save(business("business-a"));
    await businesses.save(business("business-b"));

    const guard = new SqliteEvolutionGoWebhookReplayGuard(database);
    const claim = {
      businessId: "business-a",
      instanceName: "instance-a",
      externalMessageId: "message-synthetic-1",
      receivedAt: "2026-01-02T03:04:05.000Z",
    };

    assert.equal(guard.claim(claim), true);
    assert.equal(guard.claim(claim), false);
    assert.equal(guard.claim({ ...claim, instanceName: "instance-b" }), true);
    assert.equal(guard.claim({ ...claim, businessId: "business-b" }), true);

    const storedRows = database.prepare(
      "SELECT * FROM evolution_go_webhook_receipts ORDER BY business_id, instance_name",
    ).all();
    assert.equal(storedRows.length, 3);
    assert.deepEqual(
      Object.keys(storedRows[0] ?? {}).sort(),
      ["business_id", "external_message_id", "instance_name", "received_at"],
    );
    const storedText = JSON.stringify(storedRows);
    assert.equal(storedText.includes("synthetic-instance-token"), false);
    assert.equal(storedText.includes("synthetic-customer-message-content"), false);

    database.close();
    database = createSqliteDatabase({ filename });
    const guardAfterRestart = new SqliteEvolutionGoWebhookReplayGuard(database);
    assert.equal(guardAfterRestart.claim(claim), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
