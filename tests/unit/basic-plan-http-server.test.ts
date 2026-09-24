import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { Script } from "node:vm";
import type { AutomotiveBusiness } from "../../src/core/domain/entities.js";
import { BusinessType, Channel, Intent, SenderType, QuoteRequestStatus } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { InMemoryAppointmentRepository, InMemoryHumanHandoffRepository } from "../../src/core/in-memory-repositories.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteCustomerRepository } from "../../src/infrastructure/sqlite/sqlite-customer-repository.js";
import { SqliteMessageRepository } from "../../src/infrastructure/sqlite/sqlite-message-repository.js";
import { SqliteOpportunityRepository } from "../../src/infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteQuoteRequestRepository } from "../../src/infrastructure/sqlite/sqlite-quote-request-repository.js";
import { SqliteVehicleRepository } from "../../src/infrastructure/sqlite/sqlite-vehicle-repository.js";
import { createBasicPlanHttpServer } from "../../src/infrastructure/http/basic-plan-http-server.js";

const timestamp = "2026-09-24T12:00:00.000Z";
const interpretation: AIInterpretation = {
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: { name: "Carlos" },
  extractedVehicleData: { brand: "Toyota", model: "Corolla", year: 2020, version: "XEi" },
  requestedItem: "Pastilhas de freio",
  missingData: [],
  suggestedNextAction: { type: "PROVIDE_QUOTE", description: "Fornecer orçamento" },
  requiresHuman: false,
  proposedResponse: "Vamos preparar seu orçamento.",
};

test("serves the commercial cycle over HTTP and enforces business isolation", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  const businessRepository = new SqliteAutomotiveBusinessRepository(database);
  const conversationRepository = new SqliteConversationRepository(database);
  const customerRepository = new SqliteCustomerRepository(database);
  const vehicleRepository = new SqliteVehicleRepository(database);
  const messageRepository = new SqliteMessageRepository(database);
  const opportunityRepository = new SqliteOpportunityRepository(database);
  const quoteRequestRepository = new SqliteQuoteRequestRepository(database);
  const business: AutomotiveBusiness = {
    id: "business-a", name: "Oficina A", businessType: BusinessType.WORKSHOP,
    timezone: "America/Sao_Paulo", active: true, createdAt: timestamp, updatedAt: timestamp,
  };
  await businessRepository.save(business);
  await businessRepository.save({ ...business, id: "business-b", name: "Oficina B" });

  let sequence = 0;
  const serverDependencies = {
    conversationRepository, messageRepository, customerRepository, vehicleRepository,
    opportunityRepository, quoteRequestRepository,
    appointmentRepository: new InMemoryAppointmentRepository(),
    humanHandoffRepository: new InMemoryHumanHandoffRepository(),
    operator: { businessId: "business-a", businessName: "Oficina A" },
    interpreter: { interpret: async () => interpretation },
    now: () => timestamp,
    generateId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  const server = createBasicPlanHttpServer(serverDependencies);

  let baseUrl = "";
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    const request = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);
    const post = (path: string, body: unknown) => request(path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });

    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await health.json(), { status: "ok" });

    const operatorPage = await request("/operator");
    assert.equal(operatorPage.status, 200);
    assert.match(operatorPage.headers.get("content-type") ?? "", /^text\/html; charset=utf-8$/);
    const operatorHtml = await operatorPage.text();
    assert.match(operatorHtml, /Ampliview/);
    assert.match(operatorHtml, /Oficina A/);
    assert.match(operatorHtml, /Orçamentos/);
    assert.match(operatorHtml, /id="queue-panel"/);
    assert.match(operatorHtml, /id="detail-panel"/);
    assert.match(operatorHtml, /historyArea\.id = "conversation-history"/);
    assert.match(operatorHtml, /Carregando atendimento/);
    assert.match(operatorHtml, /Atendente IA/);
    assert.doesNotMatch(operatorHtml, /innerHTML/);
    assert.doesNotMatch(operatorHtml, /super-secret-test-key|GROQ_API_KEY/);
    assert.match(operatorHtml, /meta name="viewport"/);
    const operatorScript = operatorHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(operatorScript);
    assert.doesNotThrow(() => new Script(operatorScript));

    const maliciousNameServer = createBasicPlanHttpServer({
      ...serverDependencies,
      operator: { businessId: "business-a", businessName: "</script><script>alert(1)</script>" },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        maliciousNameServer.once("error", reject);
        maliciousNameServer.listen(0, "127.0.0.1", resolve);
      });
      const maliciousAddress = maliciousNameServer.address() as AddressInfo;
      const maliciousHtml = await (await fetch(`http://127.0.0.1:${maliciousAddress.port}/operator`)).text();
      assert.equal(maliciousHtml.includes("<script>alert(1)</script>"), false);
      assert.match(maliciousHtml, /\\u003c\/script\\u003e/);
      const maliciousScript = maliciousHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
      assert.ok(maliciousScript);
      assert.doesNotThrow(() => new Script(maliciousScript));
    } finally {
      await new Promise<void>((resolve) => {
        if (!maliciousNameServer.listening) return resolve();
        maliciousNameServer.close(() => resolve());
      });
    }

    const invalidJson = await request("/v1/businesses/business-a/conversations", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    });
    assert.equal(invalidJson.status, 400);
    const oversizedBody = await request("/v1/businesses/business-a/conversations", {
      method: "POST", headers: { "content-type": "application/json" }, body: `{"channel":"WEB","extra":"${"x".repeat(1024 * 1024)}"}`,
    });
    assert.equal(oversizedBody.status, 413);
    const invalidChannel = await post("/v1/businesses/business-a/conversations", { channel: "INVALID" });
    assert.equal(invalidChannel.status, 400);

    const created = await post("/v1/businesses/business-a/conversations", { channel: Channel.WEB });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { conversationId: string; businessId: string };
    const conversationId = createdBody.conversationId;
    assert.equal(createdBody.businessId, "business-a");

    const missingConversation = await post("/v1/businesses/business-a/conversations/missing/messages", { content: "Oi" });
    assert.equal(missingConversation.status, 404);
    const emptyContent = await post(`/v1/businesses/business-a/conversations/${conversationId}/messages`, { content: "  " });
    assert.equal(emptyContent.status, 400);

    const incomingText = "Meu nome é Carlos. Tenho um Toyota Corolla XEi 2020 e quero orçamento para pastilhas de freio.";
    const processed = await post(`/v1/businesses/business-a/conversations/${conversationId}/messages`, { content: incomingText });
    assert.equal(processed.status, 200);
    assert.equal((await processed.json() as { conversationId: string }).conversationId, conversationId);

    const historyResponse = await request(`/v1/businesses/business-a/conversations/${conversationId}/messages`);
    assert.equal(historyResponse.status, 200);
    const history = (await historyResponse.json() as { messages: Array<{ content: string; senderType: string }> }).messages;
    assert.ok(history.some((message) => message.senderType === SenderType.CUSTOMER && message.content === incomingText));
    assert.ok(history.some((message) => message.senderType === SenderType.ASSISTANT));

    const quotesResponse = await request(`/v1/businesses/business-a/conversations/${conversationId}/quotes`);
    const quotes = (await quotesResponse.json() as { quotes: Array<{ id: string; status: string }> }).quotes;
    assert.equal(quotesResponse.status, 200);
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0]?.status, QuoteRequestStatus.WAITING_BUSINESS);
    const quoteId = quotes[0]!.id;
    const queueQuote = await quoteRequestRepository.findById("business-a", quoteId);
    assert.ok(queueQuote);

    const pendingResponse = await request("/v1/businesses/business-a/quotes/pending");
    assert.equal(pendingResponse.status, 200);
    const pendingItems = (await pendingResponse.json() as {
      items: Array<{
        quote: { id: string; status: string };
        customer: { name?: string } | null;
        vehicle: { brand?: string; model?: string; year?: number; version?: string } | null;
        conversation: { businessId: string } | null;
      }>;
    }).items;
    assert.equal(pendingItems.length, 1);
    assert.equal(pendingItems[0]?.quote.status, QuoteRequestStatus.WAITING_BUSINESS);
    assert.equal(pendingItems[0]?.customer?.name, "Carlos");
    assert.deepEqual(pendingItems[0]?.vehicle && {
      brand: pendingItems[0].vehicle.brand,
      model: pendingItems[0].vehicle.model,
      year: pendingItems[0].vehicle.year,
      version: pendingItems[0].vehicle.version,
    }, { brand: "Toyota", model: "Corolla", year: 2020, version: "XEi" });
    assert.equal(pendingItems[0]?.conversation?.businessId, "business-a");

    const publishedTooEarly = await post(`/v1/businesses/business-a/quotes/${quoteId}/publish`, {});
    assert.equal(publishedTooEarly.status, 409);
    const invalidNegativePrice = await post(`/v1/businesses/business-a/quotes/${quoteId}/respond`, { amountCents: -1, currency: "BRL" });
    assert.equal(invalidNegativePrice.status, 400);
    const invalidDecimalPrice = await post(`/v1/businesses/business-a/quotes/${quoteId}/respond`, { amountCents: 10.5, currency: "BRL" });
    assert.equal(invalidDecimalPrice.status, 400);
    const invalidCurrency = await post(`/v1/businesses/business-a/quotes/${quoteId}/respond`, { amountCents: 65000, currency: "USD" });
    assert.equal(invalidCurrency.status, 400);
    const missingQuote = await post("/v1/businesses/business-a/quotes/missing/respond", { amountCents: 1, currency: "BRL" });
    assert.equal(missingQuote.status, 404);

    const otherBusinessMessages = await request(`/v1/businesses/business-b/conversations/${conversationId}/messages`);
    const otherBusinessQuotes = await request(`/v1/businesses/business-b/conversations/${conversationId}/quotes`);
    assert.deepEqual((await otherBusinessMessages.json() as { messages: unknown[] }).messages, []);
    assert.deepEqual((await otherBusinessQuotes.json() as { quotes: unknown[] }).quotes, []);
    const crossTenantRespond = await post(`/v1/businesses/business-b/quotes/${quoteId}/respond`, { amountCents: 65000, currency: "BRL" });
    const crossTenantPublish = await post(`/v1/businesses/business-b/quotes/${quoteId}/publish`, {});
    assert.equal(crossTenantRespond.status, 404);
    assert.equal(crossTenantPublish.status, 404);

    const responded = await post(`/v1/businesses/business-a/quotes/${quoteId}/respond`, { amountCents: 65000, currency: "BRL" });
    assert.equal(responded.status, 200);
    assert.deepEqual((await responded.json() as { authorizedPrice: unknown }).authorizedPrice, { amountCents: 65000, currency: "BRL" });
    const queueAfterRespond = await request("/v1/businesses/business-a/quotes/pending");
    assert.deepEqual(await queueAfterRespond.json(), { items: [] });
    const secondResponse = await post(`/v1/businesses/business-a/quotes/${quoteId}/respond`, { amountCents: 65000, currency: "BRL" });
    assert.equal(secondResponse.status, 409);

    const published = await post(`/v1/businesses/business-a/quotes/${quoteId}/publish`, {});
    assert.equal(published.status, 200);
    const publishedBody = await published.json() as { content: string; channel: string };
    assert.equal(publishedBody.content, "O orçamento autorizado é de R$ 650,00. Deseja prosseguir?");
    assert.equal(publishedBody.channel, Channel.WEB);
    const finalHistory = (await (await request(`/v1/businesses/business-a/conversations/${conversationId}/messages`)).json() as { messages: Array<{ content: string; senderType: string }> }).messages;
    assert.ok(finalHistory.some((message) => message.senderType === SenderType.ASSISTANT && message.content === publishedBody.content));

    for (const status of [
      QuoteRequestStatus.REQUESTED,
      QuoteRequestStatus.WAITING_INFORMATION,
      QuoteRequestStatus.WAITING_BUSINESS,
      QuoteRequestStatus.RESPONDED,
      QuoteRequestStatus.CANCELLED,
      QuoteRequestStatus.CLOSED,
    ]) {
      await quoteRequestRepository.save({ ...queueQuote, id: `status-${status}`, status });
    }
    const statusesInQueue = (await (await request("/v1/businesses/business-a/quotes/pending")).json() as {
      items: Array<{ quote: { status: string } }>;
    }).items.map(({ quote }) => quote.status).sort();
    assert.deepEqual(statusesInQueue, [
      QuoteRequestStatus.REQUESTED,
      QuoteRequestStatus.WAITING_BUSINESS,
      QuoteRequestStatus.WAITING_INFORMATION,
    ]);
    const secondBusinessQueue = await request("/v1/businesses/business-b/quotes/pending");
    assert.deepEqual(await secondBusinessQueue.json(), { items: [] });

    const unknownRoute = await request("/not-a-route");
    assert.equal(unknownRoute.status, 404);
    assert.deepEqual(await unknownRoute.json(), { error: "Not found" });
  } finally {
    await new Promise<void>((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
    database.close();
  }
});
