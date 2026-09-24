import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { BusinessType, Channel, ConversationStatus } from "../../src/core/domain/enums.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { createBasicPlanRuntime } from "../../src/app/basic-plan-runtime.js";

const business = {
  businessId: "pilot-workshop",
  businessName: "Oficina Piloto",
  businessType: BusinessType.WORKSHOP,
  timezone: "America/Sao_Paulo",
};

test("creates and reuses the pilot business and persists conversations across runtimes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "basic-plan-runtime-"));
  const databasePath = join(directory, "nested", "atendente.db");
  const interpreter = { interpret: async () => { throw new Error("Interpreter should not be called"); } };
  let firstRuntime: Awaited<ReturnType<typeof createBasicPlanRuntime>> | undefined;
  let secondRuntime: Awaited<ReturnType<typeof createBasicPlanRuntime>> | undefined;

  try {
    firstRuntime = await createBasicPlanRuntime({
      databasePath, business, interpreter, now: () => "2026-09-24T12:00:00.000Z",
    });
    assert.equal(existsSync(databasePath), true);
    const initialBusinesses = firstRuntime.database.prepare("SELECT COUNT(*) AS count FROM automotive_businesses").get() as { count: number };
    assert.equal(initialBusinesses.count, 1);

    await new Promise<void>((resolve, reject) => {
      firstRuntime!.server.once("error", reject);
      firstRuntime!.server.listen(0, "127.0.0.1", resolve);
    });
    const firstAddress = firstRuntime.server.address() as AddressInfo;
    const health = await fetch(`http://127.0.0.1:${firstAddress.port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const createConversation = async (port: number) => {
      const response = await fetch(`http://127.0.0.1:${port}/v1/businesses/${business.businessId}/conversations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: Channel.WEB }),
      });
      assert.equal(response.status, 201);
      return response.json() as Promise<{ conversationId: string; businessId: string; status: string }>;
    };
    const firstConversation = await createConversation(firstAddress.port);
    assert.equal(firstConversation.businessId, business.businessId);
    assert.equal(firstConversation.status, ConversationStatus.ACTIVE);
    const firstId = firstConversation.conversationId;

    await firstRuntime.close();
    await firstRuntime.close();
    assert.throws(() => firstRuntime!.database.prepare("SELECT 1"));
    firstRuntime = undefined;

    secondRuntime = await createBasicPlanRuntime({
      databasePath, business, interpreter, now: () => "2026-09-25T12:00:00.000Z",
    });
    const businessRepository = new SqliteAutomotiveBusinessRepository(secondRuntime.database);
    const savedBusiness = await businessRepository.findById(business.businessId);
    assert.deepEqual(savedBusiness && {
      id: savedBusiness.id,
      name: savedBusiness.name,
      businessType: savedBusiness.businessType,
      timezone: savedBusiness.timezone,
      createdAt: savedBusiness.createdAt,
      updatedAt: savedBusiness.updatedAt,
    }, {
      id: business.businessId,
      name: business.businessName,
      businessType: business.businessType,
      timezone: business.timezone,
      createdAt: "2026-09-24T12:00:00.000Z",
      updatedAt: "2026-09-24T12:00:00.000Z",
    });
    const secondBusinesses = secondRuntime.database.prepare("SELECT COUNT(*) AS count FROM automotive_businesses").get() as { count: number };
    assert.equal(secondBusinesses.count, 1);

    const conversationRepository = new SqliteConversationRepository(secondRuntime.database);
    const persistedConversation = await conversationRepository.findById(business.businessId, firstId);
    assert.ok(persistedConversation);
    assert.equal(persistedConversation.channel, Channel.WEB);

    await new Promise<void>((resolve, reject) => {
      secondRuntime!.server.once("error", reject);
      secondRuntime!.server.listen(0, "127.0.0.1", resolve);
    });
    const secondAddress = secondRuntime.server.address() as AddressInfo;
    const secondConversation = await createConversation(secondAddress.port);
    assert.notEqual(secondConversation.conversationId, firstId);

    await secondRuntime.close();
    await secondRuntime.close();
    assert.throws(() => secondRuntime!.database.prepare("SELECT 1"));
    secondRuntime = undefined;
  } finally {
    if (firstRuntime) await firstRuntime.close();
    if (secondRuntime) await secondRuntime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
