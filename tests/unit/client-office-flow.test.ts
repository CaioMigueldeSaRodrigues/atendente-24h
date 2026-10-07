import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { AutomotiveBusiness } from "../../src/core/domain/entities.js";
import { BusinessType, Channel, CommercialEventType, CommercialOutcome, Intent, OpportunityStatus, QuoteRequestStatus, SenderType } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { InMemoryAppointmentRepository, InMemoryHumanHandoffRepository } from "../../src/core/in-memory-repositories.js";
import type { MessageInterpreter } from "../../src/core/message-interpreter.js";
import { createBasicPlanHttpServer } from "../../src/infrastructure/http/basic-plan-http-server.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";
import { withSqliteTransaction } from "../../src/infrastructure/sqlite/sqlite-connection-lock.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteCommercialEventRepository } from "../../src/infrastructure/sqlite/sqlite-commercial-event-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteCustomerRepository } from "../../src/infrastructure/sqlite/sqlite-customer-repository.js";
import { SqliteEvolutionGoConversationLinkRepository } from "../../src/infrastructure/sqlite/sqlite-evolution-go-conversation-link-repository.js";
import { SqliteMessageRepository } from "../../src/infrastructure/sqlite/sqlite-message-repository.js";
import { SqliteOpportunityRepository } from "../../src/infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteQuoteRequestRepository } from "../../src/infrastructure/sqlite/sqlite-quote-request-repository.js";
import { SqliteVehicleRepository } from "../../src/infrastructure/sqlite/sqlite-vehicle-repository.js";
import { SqliteOutboundDeliveryRepository } from "../../src/infrastructure/sqlite/sqlite-outbound-delivery-repository.js";

const timestamp = "2026-10-01T12:00:00.000Z";

const firstTurn: AIInterpretation = {
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: { name: "Carlos" },
  extractedVehicleData: { model: "Onix", year: 2020 },
  requestedItem: "Troca de óleo",
  missingData: ["brand", "version"],
  suggestedNextAction: { type: "REQUEST_INFORMATION", description: "Solicitar marca e versão" },
  requiresHuman: false,
  proposedResponse: "Preciso da marca e da versão do veículo.",
};

const secondTurn: AIInterpretation = {
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: {},
  extractedVehicleData: { brand: "Chevrolet", version: "LT" },
  requestedItem: "Troca de óleo",
  missingData: [],
  suggestedNextAction: { type: "PROVIDE_QUOTE", description: "Aguardar orçamento da oficina" },
  requiresHuman: false,
  proposedResponse: "Vou encaminhar o pedido para a oficina.",
};

test("registra orçamento no primeiro turno e aceita dados opcionais depois sem duplicar o pedido", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  const businessRepository = new SqliteAutomotiveBusinessRepository(database);
  const conversationRepository = new SqliteConversationRepository(database);
  const customerRepository = new SqliteCustomerRepository(database);
  const vehicleRepository = new SqliteVehicleRepository(database);
  const messageRepository = new SqliteMessageRepository(database);
  const opportunityRepository = new SqliteOpportunityRepository(database);
  const quoteRequestRepository = new SqliteQuoteRequestRepository(database);
  const commercialEventRepository = new SqliteCommercialEventRepository(database);
  const outboundDeliveryRepository = new SqliteOutboundDeliveryRepository(database);
  const linkRepository = new SqliteEvolutionGoConversationLinkRepository(database);
  const business: AutomotiveBusiness = {
    id: "business-a",
    name: "Oficina A",
    businessType: BusinessType.WORKSHOP,
    timezone: "America/Sao_Paulo",
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await businessRepository.save(business);
  await businessRepository.save({ ...business, id: "business-b", name: "Oficina B" });

  const interpreterInputs: Array<{ content: string; history: Array<{ content: string; senderType: string }> }> = [];
  const interpretations = [firstTurn, secondTurn];
  let interpreterIndex = 0;
  const interpreter: MessageInterpreter = {
    async interpret(input) {
      interpreterInputs.push({
        content: input.content,
        history: input.history.map((message) => ({ content: message.content, senderType: message.senderType })),
      });
      return interpretations[Math.min(interpreterIndex++, interpretations.length - 1)]!;
    },
  };

  let sequence = 0;
  const sentMessages: Array<{ recipientJid: string; content: string }> = [];
  const server = createBasicPlanHttpServer({
    conversationRepository,
    messageRepository,
    customerRepository,
    vehicleRepository,
    opportunityRepository,
    quoteRequestRepository,
    outboundDeliveryRepository,
    commercialEventRepository,
    evolutionGoConversationLinkRepository: linkRepository,
    channelTextSenders: {
      [Channel.WHATSAPP]: {
        async sendText(message) {
          sentMessages.push(message);
        },
      },
    },
    appointmentRepository: new InMemoryAppointmentRepository(),
    humanHandoffRepository: new InMemoryHumanHandoffRepository(),
    evolutionGoWebhookTransaction: { run: <T>(operation: () => Promise<T>) => withSqliteTransaction(database, operation) },
    operator: { businessId: "business-a", businessName: "Oficina A" },
    businessOperatorAuthorizer: { isAuthorized: async ({ businessId }) => businessId === "business-a" },
    interpreter,
    now: () => timestamp,
    generateId: (prefix: string) => `${prefix}-${++sequence}`,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const request = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);
    const post = (path: string, body: unknown) => request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const created = await post("/v1/businesses/business-a/conversations", { channel: Channel.WHATSAPP });
    assert.equal(created.status, 201);
    const conversationId = (await created.json() as { conversationId: string }).conversationId;
    await linkRepository.save({
      businessId: "business-a",
      instanceName: "instance-a",
      senderJid: "5511999990000@s.whatsapp.net",
      conversationId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const message1 = "Olá, gostaria de um orçamento para troca de óleo do meu Onix 2020.";
    const message2 = "Chevrolet, versão LT.";
    const firstResponse = await post(`/v1/businesses/business-a/conversations/${conversationId}/messages`, { content: message1 });
    assert.equal(firstResponse.status, 200);
    const firstBody = await firstResponse.json() as { conversationId: string; reply: string };
    assert.equal(firstBody.conversationId, conversationId);

    const firstOpportunities = await opportunityRepository.listByConversation("business-a", conversationId);
    const firstQuoteRequests = await quoteRequestRepository.listByConversation("business-a", conversationId);
    assert.equal(firstOpportunities.length, 1);
    assert.equal(firstQuoteRequests.length, 1);
    assert.equal(firstOpportunities[0]?.status, OpportunityStatus.WAITING_BUSINESS);
    assert.equal(firstQuoteRequests[0]?.status, QuoteRequestStatus.WAITING_BUSINESS);
    assert.equal(firstBody.reply, "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.");

    const secondResponse = await post(`/v1/businesses/business-a/conversations/${conversationId}/messages`, { content: message2 });
    assert.equal(secondResponse.status, 200);
    assert.equal((await secondResponse.json() as { conversationId: string }).conversationId, conversationId);

    const conversation = await conversationRepository.findById("business-a", conversationId);
    assert.ok(conversation);
    assert.ok(conversation.customerId);
    assert.ok(conversation.vehicleId);
    const customer = await customerRepository.findById("business-a", conversation.customerId);
    const vehicle = await vehicleRepository.findById("business-a", conversation.vehicleId);
    const opportunities = await opportunityRepository.listByConversation("business-a", conversationId);
    const quoteRequests = await quoteRequestRepository.listByConversation("business-a", conversationId);
    const messages = await messageRepository.listByConversation("business-a", conversationId);

    assert.equal(customer?.name, "Carlos");
    assert.deepEqual({ brand: vehicle?.brand, model: vehicle?.model, year: vehicle?.year, version: vehicle?.version }, {
      brand: "Chevrolet", model: "Onix", year: 2020, version: "LT",
    });
    assert.equal(opportunities.length, 1);
    assert.equal(quoteRequests.length, 1);
    assert.equal(opportunities[0]?.customerId, conversation.customerId);
    assert.equal(opportunities[0]?.vehicleId, conversation.vehicleId);
    assert.equal(opportunities[0]?.requestDescription, "Troca de óleo");
    assert.equal(opportunities[0]?.status, OpportunityStatus.WAITING_BUSINESS);
    assert.equal(quoteRequests[0]?.opportunityId, opportunities[0]?.id);
    assert.equal(quoteRequests[0]?.customerId, conversation.customerId);
    assert.equal(quoteRequests[0]?.vehicleId, conversation.vehicleId);
    assert.equal(quoteRequests[0]?.requestDescription, "Troca de óleo");
    assert.equal(quoteRequests[0]?.status, QuoteRequestStatus.WAITING_BUSINESS);
    assert.equal(messages.filter((message) => message.senderType === SenderType.CUSTOMER).length, 2);
    assert.equal(messages.filter((message) => message.senderType === SenderType.ASSISTANT).length, 2);
    assert.equal(interpreterInputs.length, 2);
    assert.deepEqual(interpreterInputs[0]?.history, [
      { content: message1, senderType: SenderType.CUSTOMER },
    ]);
    assert.deepEqual(interpreterInputs[1]?.history, [
      { content: message1, senderType: SenderType.CUSTOMER },
      { content: firstBody.reply, senderType: SenderType.ASSISTANT },
      { content: message2, senderType: SenderType.CUSTOMER },
    ]);

    const pendingResponse = await request("/v1/businesses/business-a/quotes/pending");
    assert.equal(pendingResponse.status, 200);
    const pending = (await pendingResponse.json() as { items: Array<{
      quote: { id: string; status: string; requestDescription?: string; symptomDescription?: string };
      customer: { name?: string } | null;
      vehicle: { brand?: string; model?: string; year?: number; version?: string } | null;
      conversation: { id: string; businessId: string } | null;
    }> }).items;
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.quote.id, quoteRequests[0]?.id);
    assert.equal(pending[0]?.quote.status, QuoteRequestStatus.WAITING_BUSINESS);
    assert.equal(pending[0]?.quote.requestDescription, "Troca de óleo");
    assert.equal(pending[0]?.customer?.name, "Carlos");
    assert.deepEqual(pending[0]?.vehicle && {
      brand: pending[0].vehicle.brand,
      model: pending[0].vehicle.model,
      year: pending[0].vehicle.year,
      version: pending[0].vehicle.version,
    }, { brand: "Chevrolet", model: "Onix", year: 2020, version: "LT" });
    assert.equal(pending[0]?.conversation?.id, conversationId);
    assert.equal(pending[0]?.conversation?.businessId, "business-a");

    const quoteId = quoteRequests[0]!.id;
    const opportunityId = opportunities[0]!.id;
    assert.equal(quoteRequests[0]?.authorizedPrice, undefined);
    assert.equal(quoteRequests[0]?.respondedAt, undefined);
    assert.equal(conversation.commercialOutcome, CommercialOutcome.QUOTE_REQUESTED);

    const respondResponse = await post(`/v1/businesses/business-a/quotes/${quoteId}/respond`, {
      amountCents: 65000,
      currency: "BRL",
    });
    assert.equal(respondResponse.status, 200);
    assert.deepEqual((await respondResponse.json() as { authorizedPrice: unknown }).authorizedPrice, {
      amountCents: 65000,
      currency: "BRL",
    });

    const respondedQuote = await quoteRequestRepository.findById("business-a", quoteId);
    const respondedOpportunity = await opportunityRepository.findById("business-a", opportunityId);
    assert.equal(respondedQuote?.status, QuoteRequestStatus.RESPONDED);
    assert.deepEqual(respondedQuote?.authorizedPrice, { amountCents: 65000, currency: "BRL" });
    assert.equal(respondedQuote?.respondedAt, timestamp);
    assert.equal(respondedOpportunity?.status, OpportunityStatus.WAITING_CUSTOMER);
    assert.deepEqual((await commercialEventRepository.listByBusiness("business-a")).map(({ eventType }) => eventType).sort(), [
      CommercialEventType.QUOTE_REQUESTED,
      CommercialEventType.QUOTE_RESPONDED,
    ].sort());

    const queueAfterRespond = await request("/v1/businesses/business-a/quotes/pending");
    const authorizedItems = (await queueAfterRespond.json() as { items: Array<{ quote: { status: string } }> }).items;
    assert.equal(authorizedItems.length, 1);
    assert.equal(authorizedItems[0]?.quote.status, QuoteRequestStatus.RESPONDED);

    const publishResponse = await post(`/v1/businesses/business-a/quotes/${quoteId}/publish`, {});
    assert.equal(publishResponse.status, 200);
    const published = await publishResponse.json() as { messageId: string; conversationId: string; content: string; channel: string; delivery: { status: string } };
    assert.equal(published.conversationId, conversationId);
    assert.equal(published.channel, Channel.WHATSAPP);
    assert.match(published.content, /650/);
    assert.equal(published.delivery.status, "DELIVERED");
    assert.deepEqual(sentMessages, [{
      recipientJid: "5511999990000@s.whatsapp.net",
      content: published.content,
    }]);
    const outboundDelivery = await outboundDeliveryRepository.findByMessageAndChannel(
      "business-a", published.messageId, Channel.WHATSAPP,
    );
    assert.equal(outboundDelivery?.status, "DELIVERED");
    assert.equal(outboundDelivery?.attempts, 1);
    assert.equal(outboundDelivery?.recipientRef, "5511999990000@s.whatsapp.net");
    assert.ok(outboundDelivery?.deliveredAt);

    const finalMessages = await messageRepository.listByConversation("business-a", conversationId);
    assert.equal(finalMessages.length, 5);
    const publishedMessage = finalMessages.find((message) => message.content === published.content);
    assert.equal(publishedMessage?.senderType, SenderType.ASSISTANT);
    assert.equal(finalMessages.filter((message) => message.senderType === SenderType.ASSISTANT).length, 3);
    const finalConversation = await conversationRepository.findById("business-a", conversationId);
    const finalQuote = await quoteRequestRepository.findById("business-a", quoteId);
    assert.equal(finalConversation?.lastMessageAt, timestamp);
    assert.equal(finalConversation?.commercialOutcome, CommercialOutcome.QUOTE_REQUESTED);
    assert.equal(finalQuote?.status, QuoteRequestStatus.RESPONDED);
    assert.deepEqual(finalQuote?.authorizedPrice, { amountCents: 65000, currency: "BRL" });
    assert.deepEqual((await commercialEventRepository.listByBusiness("business-a")).map(({ eventType }) => eventType).sort(), [
      CommercialEventType.QUOTE_REQUESTED,
      CommercialEventType.QUOTE_RESPONDED,
      CommercialEventType.QUOTE_PUBLISHED,
    ].sort());

    const repeatedPublishResponse = await post(`/v1/businesses/business-a/quotes/${quoteId}/publish`, {});
    assert.equal(repeatedPublishResponse.status, 200);
    const repeatedPublish = await repeatedPublishResponse.json() as { messageId: string; delivery: { status: string } };
    assert.equal(repeatedPublish.messageId, published.messageId);
    assert.equal(repeatedPublish.delivery.status, "ALREADY_DELIVERED");
    assert.equal(sentMessages.length, 1);
    assert.equal((await outboundDeliveryRepository.findByMessageAndChannel(
      "business-a", published.messageId, Channel.WHATSAPP,
    ))?.attempts, 1);
    assert.equal((await messageRepository.listByConversation("business-a", conversationId)).length, 5);
    assert.equal((await commercialEventRepository.listByBusiness("business-a")).length, 3);

    const otherBusinessQueue = await request("/v1/businesses/business-b/quotes/pending");
    assert.equal(otherBusinessQueue.status, 404);
    assert.deepEqual(await otherBusinessQueue.json(), { error: "Not found" });

    const operatorPage = await request("/operator");
    assert.equal(operatorPage.status, 200);
    const operatorHtml = await operatorPage.text();
    assert.match(operatorHtml, /quotes\/pending/);
    assert.match(operatorHtml, /conversations\/.+\/messages/);
    assert.match(operatorHtml, /vehicle\.brand/);
    assert.match(operatorHtml, /vehicle\.model/);
    assert.match(operatorHtml, /vehicle\.year/);
    assert.match(operatorHtml, /vehicle\.version/);
    assert.match(operatorHtml, /item\.quote\.requestDescription/);
    assert.match(operatorHtml, /item\.quote\.symptomDescription/);
  } finally {
    await new Promise<void>((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
    database.close();
  }
});
