import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { BusinessType, Channel, ConversationStatus, Intent } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { createBasicPlanRuntime } from "../../src/app/basic-plan-runtime.js";
import { BasicBusinessOperatorAuthorizer } from "../../src/infrastructure/http/basic-business-operator-authorizer.js";

const business = {
  businessId: "pilot-workshop",
  businessName: "Oficina Piloto",
  businessType: BusinessType.WORKSHOP,
  timezone: "America/Sao_Paulo",
};
const operatorAuthorization = `Basic ${Buffer.from("operator:synthetic-password").toString("base64")}`;
const businessOperatorAuthorizer = new BasicBusinessOperatorAuthorizer(
  business.businessId,
  "operator",
  "synthetic-password",
);
const webhookCredential = {
  instanceName: "instance-synthetic-1",
  instanceToken: "fake-evolution-token-for-runtime-test-only",
  businessId: business.businessId,
};
const runtimeInterpretation: AIInterpretation = {
  intent: Intent.GENERAL_INFORMATION,
  extractedCustomerData: {},
  extractedVehicleData: {},
  missingData: [],
  suggestedNextAction: { type: "NONE", description: "Nenhuma ação adicional" },
  requiresHuman: false,
  proposedResponse: "Resposta sintética do runtime",
};

test("rejects weak operator credentials", () => {
  assert.throws(
    () => new BasicBusinessOperatorAuthorizer(business.businessId, "operator", "short"),
    /Operator credentials are invalid/,
  );
});

test("rejects an Evolution Go credential configured for another business", async () => {
  await assert.rejects(
    createBasicPlanRuntime({
      databasePath: ":memory:",
      business,
      businessOperatorAuthorizer,
      interpreter: { interpret: async () => { throw new Error("Interpreter should not be called"); } },
      evolutionGoWebhookCredential: {
        ...webhookCredential,
        businessId: "business-synthetic-other",
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Evolution Go webhook business does not match the configured business");
      assert.equal(error.message.includes(webhookCredential.instanceToken), false);
      return true;
    },
  );
});

test("creates and reuses the pilot business and persists conversations across runtimes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "basic-plan-runtime-"));
  const databasePath = join(directory, "nested", "atendente.db");
  const interpreter = { interpret: async () => { throw new Error("Interpreter should not be called"); } };
  const sentMessages: Array<{ recipientJid: string; content: string }> = [];
  let firstRuntime: Awaited<ReturnType<typeof createBasicPlanRuntime>> | undefined;
  let secondRuntime: Awaited<ReturnType<typeof createBasicPlanRuntime>> | undefined;

  try {
    firstRuntime = await createBasicPlanRuntime({
      databasePath, business, interpreter, now: () => "2026-09-24T12:00:00.000Z",
      businessOperatorAuthorizer,
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
    const unauthenticatedOperatorPage = await fetch(`http://127.0.0.1:${firstAddress.port}/operator`);
    assert.equal(unauthenticatedOperatorPage.status, 401);
    assert.match(unauthenticatedOperatorPage.headers.get("www-authenticate") ?? "", /^Basic /);
    const invalidOperatorPage = await fetch(`http://127.0.0.1:${firstAddress.port}/operator`, {
      headers: { authorization: `Basic ${Buffer.from("operator:wrong-password").toString("base64")}` },
    });
    assert.equal(invalidOperatorPage.status, 401);
    const operatorPage = await fetch(`http://127.0.0.1:${firstAddress.port}/operator`, {
      headers: { authorization: operatorAuthorization },
    });
    assert.equal(operatorPage.status, 200);
    assert.equal(operatorPage.headers.get("x-frame-options"), "DENY");
    const crossTenant = await fetch(`http://127.0.0.1:${firstAddress.port}/v1/businesses/another-business/capabilities`, {
      headers: { authorization: operatorAuthorization },
    });
    assert.equal(crossTenant.status, 404);
    assert.match(await operatorPage.text(), /Oficina Piloto/);
    const closedWebhook = await fetch(
      `http://127.0.0.1:${firstAddress.port}/v1/channels/whatsapp/evolution-go/webhook`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(closedWebhook.status, 404);
    assert.deepEqual(await closedWebhook.json(), { error: "Not found" });

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
      databasePath,
      business,
      businessOperatorAuthorizer,
      interpreter: { interpret: async () => runtimeInterpretation },
      evolutionGoWebhookCredential: webhookCredential,
      evolutionGoTextSender: { sendText: async (message) => { sentMessages.push(message); } },
      now: () => "2026-09-25T12:00:00.000Z",
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
    const webhookUrl = `http://127.0.0.1:${secondAddress.port}/v1/channels/whatsapp/evolution-go/webhook`;
    const webhookPayload = {
      event: "Message",
      instanceName: webhookCredential.instanceName,
      instanceToken: webhookCredential.instanceToken,
      data: {
        Info: {
          ID: "runtime-message-synthetic-1",
          Type: "text",
          IsFromMe: false,
          IsGroup: false,
          Sender: "15550000001@s.whatsapp.net",
          Timestamp: "2026-09-25T12:00:00.000Z",
        },
        Message: { conversation: "Texto sintético para webhook" },
      },
    };
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });
    assert.equal(webhookResponse.status, 202);
    assert.deepEqual(await webhookResponse.json(), {
      accepted: true,
      message: {
        instanceName: webhookCredential.instanceName,
        externalMessageId: "runtime-message-synthetic-1",
        senderJid: "15550000001@s.whatsapp.net",
        content: "Texto sintético para webhook",
        occurredAt: "2026-09-25T12:00:00.000Z",
      },
    });
    const duplicateWebhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });
    assert.equal(duplicateWebhookResponse.status, 202);
    assert.deepEqual(await duplicateWebhookResponse.json(), {
      accepted: false,
      reason: "duplicate_message",
    });
    assert.deepEqual(sentMessages, [{
      recipientJid: "15550000001@s.whatsapp.net",
      content: "Resposta sintética do runtime",
    }]);

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
