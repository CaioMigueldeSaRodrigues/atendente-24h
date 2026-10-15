import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Conversation, Opportunity, QuoteRequest } from "../../src/core/domain/entities.js";
import { BusinessType, Channel, CommercialOutcome, ConversationStatus, OpportunityStatus, QuoteRequestStatus } from "../../src/core/domain/enums.js";
import { InMemoryAppointmentRepository, InMemoryHumanHandoffRepository } from "../../src/core/in-memory-repositories.js";
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

const createHarness = async ({
  channel = Channel.WHATSAPP,
  withLink = true,
  senderFails = false,
  filename = ":memory:",
  failReservation = false,
  failAttach = false,
  failConversationLoad = false,
  failRecipientResolution = false,
  failDraftLoad = false,
  failPublicationPersistence = false,
  failPublicationTransaction = false,
  authorizedAmountCents = 65000,
  secondQuote,
}: { channel?: Channel; withLink?: boolean; senderFails?: boolean; filename?: string; failReservation?: boolean; failAttach?: boolean; failConversationLoad?: boolean; failRecipientResolution?: boolean; failDraftLoad?: boolean; failPublicationPersistence?: boolean; failPublicationTransaction?: boolean; authorizedAmountCents?: number; secondQuote?: { id: string; opportunityId: string } } = {}) => {
  const database = createSqliteDatabase({ filename });
  const businessRepository = new SqliteAutomotiveBusinessRepository(database);
  const conversationRepository = new SqliteConversationRepository(database);
  const messageRepository = new SqliteMessageRepository(database);
  const customerRepository = new SqliteCustomerRepository(database);
  const vehicleRepository = new SqliteVehicleRepository(database);
  const opportunityRepository = new SqliteOpportunityRepository(database);
  const quoteRequestRepository = new SqliteQuoteRequestRepository(database);
  const outboundDeliveryRepository = new SqliteOutboundDeliveryRepository(database);
  if (failReservation) {
    outboundDeliveryRepository.reserve = async () => { throw new Error("synthetic outbox failure"); };
  }
  if (failAttach) {
    outboundDeliveryRepository.attachMessage = async () => { throw new Error("synthetic outbox attach failure"); };
  }
  if (failPublicationPersistence) {
    messageRepository.save = async () => { throw new Error("synthetic publication persistence failure"); };
  }
  const commercialEventRepository = new SqliteCommercialEventRepository(database);
  const linkRepository = new SqliteEvolutionGoConversationLinkRepository(database);
  if (failConversationLoad) {
    conversationRepository.findById = async () => null;
  }
  if (failRecipientResolution) {
    linkRepository.findByConversation = async () => { throw new Error("synthetic recipient lookup failure"); };
  }
  await businessRepository.save({
    id: "business-a",
    name: "Oficina A",
    businessType: BusinessType.WORKSHOP,
    timezone: "America/Sao_Paulo",
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const conversation: Conversation = {
    id: "conversation-publish",
    businessId: "business-a",
    channel,
    status: ConversationStatus.ACTIVE,
    commercialOutcome: CommercialOutcome.QUOTE_REQUESTED,
    startedAt: timestamp,
    lastMessageAt: timestamp,
  };
  const opportunity: Opportunity = {
    id: "opportunity-publish",
    businessId: "business-a",
    conversationId: conversation.id,
    requestDescription: "Troca de óleo",
    status: OpportunityStatus.WAITING_BUSINESS,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const quoteRequest: QuoteRequest = {
    id: "quote-publish",
    businessId: "business-a",
    opportunityId: opportunity.id,
    conversationId: conversation.id,
    requestDescription: "Troca de óleo",
    status: QuoteRequestStatus.RESPONDED,
    requestedAt: timestamp,
    respondedAt: timestamp,
    authorizedPrice: { amountCents: authorizedAmountCents, currency: "BRL" },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await conversationRepository.save(conversation);
  await opportunityRepository.save(opportunity);
  await quoteRequestRepository.save(quoteRequest);
  if (secondQuote) {
    await opportunityRepository.save({
      ...opportunity,
      id: secondQuote.opportunityId,
      status: OpportunityStatus.WAITING_BUSINESS,
    });
    await quoteRequestRepository.save({
      ...quoteRequest,
      id: secondQuote.id,
      opportunityId: secondQuote.opportunityId,
      authorizedPrice: { amountCents: authorizedAmountCents, currency: "BRL" },
    });
  }
  if (withLink) {
    await linkRepository.save({
      businessId: "business-a",
      instanceName: "instance-a",
      senderJid: "5511999990000@s.whatsapp.net",
      conversationId: conversation.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  let fail = senderFails;
  let generatedIdSequence = 0;
  const operationalEvents: string[] = [];
  const senderCalls: Array<{ recipientJid: string; content: string }> = [];
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
    ...(failDraftLoad ? {
      quoteDraftRepository: {
        findById: async () => null,
        findLatestByQuoteRequest: async () => { throw new Error("synthetic draft lookup failure"); },
        save: async () => undefined,
        approve: async () => undefined,
        markPublished: async () => undefined,
      },
    } : {}),
    channelTextSenders: {
      [Channel.WHATSAPP]: {
        async sendText(message) {
          senderCalls.push(message);
          if (fail) throw new Error("synthetic sender failure");
          return { providerMessageId: "provider-message-publish" };
        },
      },
    },
    appointmentRepository: new InMemoryAppointmentRepository(),
    humanHandoffRepository: new InMemoryHumanHandoffRepository(),
    evolutionGoWebhookTransaction: {
      run: async <T>(operation: () => Promise<T>) => {
        if (failPublicationTransaction) throw new Error("synthetic publication transaction failure");
        return withSqliteTransaction(database, operation);
      },
    },
    operator: { businessId: "business-a", businessName: "Oficina A" },
    businessOperatorAuthorizer: { isAuthorized: async ({ businessId }) => businessId === "business-a" },
    interpreter: { interpret: async () => { throw new Error("interpreter should not be called"); } },
    operationalLog: (event: string) => operationalEvents.push(event),
    now: () => timestamp,
    generateId: (prefix: string) => {
      generatedIdSequence += 1;
      return generatedIdSequence <= 2 ? `${prefix}-generated` : `${prefix}-generated-${generatedIdSequence}`;
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    post: (quoteId = quoteRequest.id) => fetch(`http://127.0.0.1:${address.port}/v1/businesses/business-a/quotes/${quoteId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    database,
    outboundDeliveryRepository,
    senderCalls,
    operationalEvents,
    secondQuoteId: secondQuote?.id,
    setSenderFailure(value: boolean) { fail = value; },
    messageRepository,
    commercialEventRepository,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    },
  };
};

test("publica o fluxo operacional sanitizado sem dados do atendimento", async () => {
  const harness = await createHarness();
  try {
    const response = await harness.post();
    assert.equal(response.status, 200);
    assert.deepEqual(harness.operationalEvents, [
      "QUOTE publish requested",
      "QUOTE authorization loaded",
      "QUOTE conversation loaded",
      "QUOTE recipient resolved",
      "QUOTE publication transaction started",
      "Outbound delivery reserved",
      "QUOTE publication persisted",
      "QUOTE publication transaction committed",
      "Evolution send accepted",
    ]);
    assert.equal(harness.operationalEvents.join(" ").includes("5511999990000"), false);
    assert.equal(harness.operationalEvents.join(" ").includes("Troca"), false);
    assert.equal(harness.operationalEvents.join(" ").includes("quote-publish"), false);
  } finally {
    await harness.close();
  }
});

test("falhas de cada etapa de publicaÃ§Ã£o registram somente a categoria segura", async () => {
  const cases = [
    { options: {}, quoteId: "missing-quote", status: 404, category: "quote_request_load" },
    { options: { failConversationLoad: true }, quoteId: undefined, status: 404, category: "conversation_load" },
    { options: { failRecipientResolution: true }, quoteId: undefined, status: 500, category: "recipient_resolution" },
    { options: { failDraftLoad: true }, quoteId: undefined, status: 500, category: "draft_validation" },
    { options: { failPublicationTransaction: true }, quoteId: undefined, status: 500, category: "publication_transaction" },
    { options: { failReservation: true }, quoteId: undefined, status: 500, category: "outbound_reservation" },
    { options: { failPublicationPersistence: true }, quoteId: undefined, status: 500, category: "publication_persistence" },
    { options: { failAttach: true }, quoteId: undefined, status: 500, category: "outbound_attach" },
  ] as const;

  for (const testCase of cases) {
    const harness = await createHarness(testCase.options);
    try {
      const response = await harness.post(testCase.quoteId);
      assert.equal(response.status, testCase.status, testCase.category);
      assert.equal(harness.operationalEvents.at(-1), `QUOTE publish error ${testCase.category}`);
      assert.equal(harness.operationalEvents.join(" ").includes("synthetic"), false);
      assert.equal(harness.operationalEvents.join(" ").includes("5511999990000"), false);
      assert.equal(harness.operationalEvents.join(" ").includes("quote-publish"), false);
    } finally {
      await harness.close();
    }
  }
});

test("sender falha sem afirmar entrega e retry reutiliza a Message publicada", async () => {
  const harness = await createHarness({ senderFails: true });
  try {
    const failed = await harness.post();
    assert.equal(failed.status, 503);
    assert.deepEqual((await failed.json() as { delivery: unknown }).delivery, {
      status: "FAILED",
      retryable: true,
    });
    assert.equal(harness.senderCalls.length, 1);
    const failedDelivery = await harness.outboundDeliveryRepository.findByMessageAndChannel(
      "business-a", "message-generated", Channel.WHATSAPP,
    );
    assert.equal(failedDelivery?.status, "FAILED_RETRYABLE");
    assert.equal(failedDelivery?.attempts, 1);
    assert.equal((await harness.messageRepository.listByConversation("business-a", "conversation-publish")).length, 1);
    assert.equal((await harness.commercialEventRepository.listByBusiness("business-a")).length, 1);

    harness.setSenderFailure(false);
    const retry = await harness.post();
    assert.equal(retry.status, 200);
    assert.deepEqual((await retry.json() as { delivery: unknown }).delivery, {
      status: "DELIVERED",
      retryable: false,
    });
    assert.equal(harness.senderCalls.length, 2);
    const delivered = await harness.outboundDeliveryRepository.findByMessageAndChannel(
      "business-a", "message-generated", Channel.WHATSAPP,
    );
    assert.equal(delivered?.status, "DELIVERED");
    assert.equal(delivered?.providerMessageId, "provider-message-publish");
    assert.equal(delivered?.attempts, 2);
    assert.equal((await harness.messageRepository.listByConversation("business-a", "conversation-publish")).length, 1);
    assert.equal((await harness.commercialEventRepository.listByBusiness("business-a")).length, 1);
  } finally {
    await harness.close();
  }
});

test("duas instâncias sobre o mesmo SQLite criam uma única publicação lógica", async () => {
  const directory = mkdtempSync(join(tmpdir(), "att24-outbox-concurrency-"));
  const filename = join(directory, "runtime.sqlite");
  const first = await createHarness({ filename });
  const second = await createHarness({ filename });
  try {
    const [a, b] = await Promise.all([first.post(), second.post()]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(first.senderCalls.length + second.senderCalls.length, 1);
    assert.equal((await first.messageRepository.listByConversation("business-a", "conversation-publish")).length, 1);
    assert.equal((await first.commercialEventRepository.listByBusiness("business-a")).length, 1);
    assert.equal((await first.outboundDeliveryRepository.findByQuoteRequestAndChannel("business-a", "quote-publish", Channel.WHATSAPP))?.attempts, 1);
  } finally {
    await first.close();
    await second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publica dois quotes iguais na mesma conversa sem reutilizar a Message financeira", async () => {
  const harness = await createHarness({
    authorizedAmountCents: 18000,
    secondQuote: { id: "quote-publish-b", opportunityId: "opportunity-publish-b" },
  });
  try {
    const first = await harness.post();
    const second = await harness.post(harness.secondQuoteId!);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const messages = (await harness.messageRepository.listByConversation("business-a", "conversation-publish"))
      .filter((message) => message.senderType === "ASSISTANT");
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.content, messages[1]?.content);

    const firstDelivery = await harness.outboundDeliveryRepository.findByQuoteRequestAndChannel("business-a", "quote-publish", Channel.WHATSAPP);
    const secondDelivery = await harness.outboundDeliveryRepository.findByQuoteRequestAndChannel("business-a", "quote-publish-b", Channel.WHATSAPP);
    assert.ok(firstDelivery);
    assert.ok(secondDelivery);
    assert.notEqual(firstDelivery.id, secondDelivery.id);
    assert.notEqual(firstDelivery.messageId, secondDelivery.messageId);
    assert.equal(firstDelivery.status, "DELIVERED");
    assert.equal(secondDelivery.status, "DELIVERED");

    const firstRetry = await harness.post();
    const secondRetry = await harness.post(harness.secondQuoteId!);
    assert.equal(firstRetry.status, 200);
    assert.equal(secondRetry.status, 200);
    assert.equal((await firstRetry.json() as { delivery: { status: string } }).delivery.status, "ALREADY_DELIVERED");
    assert.equal((await secondRetry.json() as { delivery: { status: string } }).delivery.status, "ALREADY_DELIVERED");
    assert.equal((await harness.messageRepository.listByConversation("business-a", "conversation-publish")).filter((message) => message.senderType === "ASSISTANT").length, 2);
    assert.equal(harness.senderCalls.length, 2);
  } finally {
    await harness.close();
  }
});

test("falha ao reservar outbox faz rollback da Message e do evento", async () => {
  const harness = await createHarness({ failReservation: true });
  try {
    const response = await harness.post();
    assert.equal(response.status, 500);
    assert.equal((await harness.messageRepository.listByConversation("business-a", "conversation-publish")).length, 0);
    assert.equal((await harness.commercialEventRepository.listByBusiness("business-a")).length, 0);
    assert.equal((await harness.outboundDeliveryRepository.findByQuoteRequestAndChannel("business-a", "quote-publish", Channel.WHATSAPP)), null);
  } finally {
    await harness.close();
  }
});

test("falha depois da criação da outbox faz rollback de Message, evento e outbox", async () => {
  const harness = await createHarness({ failAttach: true });
  try {
    const response = await harness.post();
    assert.equal(response.status, 500);
    assert.equal((await harness.messageRepository.listByConversation("business-a", "conversation-publish")).length, 0);
    assert.equal((await harness.commercialEventRepository.listByBusiness("business-a")).length, 0);
    assert.equal((await harness.outboundDeliveryRepository.findByQuoteRequestAndChannel("business-a", "quote-publish", Channel.WHATSAPP)), null);
  } finally {
    await harness.close();
  }
});

test("canal sem sender nÃ£o chama Evolution Go e nÃ£o marca entrega", async () => {
  const harness = await createHarness({ channel: Channel.WEB });
  try {
    const response = await harness.post();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { delivery: unknown }).delivery, {
      status: "NOT_CONFIGURED",
      retryable: false,
    });
    assert.equal(harness.senderCalls.length, 0);
    const delivery = await harness.outboundDeliveryRepository.findByMessageAndChannel(
      "business-a", "message-generated", Channel.WEB,
    );
    assert.equal(delivery?.status, "FAILED_FINAL");
    assert.match(delivery?.lastError ?? "", /sender is not configured/i);
  } finally {
    await harness.close();
  }
});

test("vÃ­nculo WhatsApp ausente falha sem usar telefone como destinatÃ¡rio", async () => {
  const harness = await createHarness({ withLink: false });
  try {
    const response = await harness.post();
    assert.equal(response.status, 503);
    assert.deepEqual((await response.json() as { delivery: unknown }).delivery, {
      status: "RECIPIENT_NOT_FOUND",
      retryable: false,
    });
    assert.equal(harness.senderCalls.length, 0);
    const delivery = await harness.outboundDeliveryRepository.findByMessageAndChannel(
      "business-a", "message-generated", Channel.WHATSAPP,
    );
    assert.equal(delivery?.status, "FAILED_FINAL");
    assert.equal(delivery?.recipientRef, undefined);
  } finally {
    await harness.close();
  }
});

test("reinício consulta DELIVERED persistido e não envia novamente", async () => {
  const directory = mkdtempSync(join(tmpdir(), "att24-outbox-restart-"));
  const filename = join(directory, "runtime.sqlite");
  const first = await createHarness({ filename });
  try {
    const response = await first.post();
    assert.equal(response.status, 200);
    assert.equal(first.senderCalls.length, 1);
    const delivered = await first.outboundDeliveryRepository.findByMessageAndChannel(
      "business-a", "message-generated", Channel.WHATSAPP,
    );
    assert.equal(delivered?.status, "DELIVERED");
    assert.equal(delivered?.attempts, 1);
    assert.ok(delivered?.deliveredAt);
  } finally {
    await first.close();
  }

  const second = await createHarness({ filename });
  try {
    const response = await second.post();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { delivery: unknown }).delivery, {
      status: "ALREADY_DELIVERED",
      retryable: false,
    });
    assert.equal(second.senderCalls.length, 0);
    const persisted = await second.outboundDeliveryRepository.findByMessageAndChannel(
      "business-a", "message-generated", Channel.WHATSAPP,
    );
    assert.equal(persisted?.attempts, 1);
  } finally {
    await second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
