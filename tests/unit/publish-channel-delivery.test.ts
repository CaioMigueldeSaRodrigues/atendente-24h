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
}: { channel?: Channel; withLink?: boolean; senderFails?: boolean; filename?: string; failReservation?: boolean; failAttach?: boolean } = {}) => {
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
  const commercialEventRepository = new SqliteCommercialEventRepository(database);
  const linkRepository = new SqliteEvolutionGoConversationLinkRepository(database);
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
    authorizedPrice: { amountCents: 65000, currency: "BRL" },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await conversationRepository.save(conversation);
  await opportunityRepository.save(opportunity);
  await quoteRequestRepository.save(quoteRequest);
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
    channelTextSenders: {
      [Channel.WHATSAPP]: {
        async sendText(message) {
          senderCalls.push(message);
          if (fail) throw new Error("synthetic sender failure");
        },
      },
    },
    appointmentRepository: new InMemoryAppointmentRepository(),
    humanHandoffRepository: new InMemoryHumanHandoffRepository(),
    evolutionGoWebhookTransaction: { run: <T>(operation: () => Promise<T>) => withSqliteTransaction(database, operation) },
    operator: { businessId: "business-a", businessName: "Oficina A" },
    businessOperatorAuthorizer: { isAuthorized: async ({ businessId }) => businessId === "business-a" },
    interpreter: { interpret: async () => { throw new Error("interpreter should not be called"); } },
    now: () => timestamp,
    generateId: (prefix: string) => `${prefix}-generated`,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  const post = () => fetch(`http://127.0.0.1:${address.port}/v1/businesses/business-a/quotes/${quoteRequest.id}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return {
    post,
    database,
    outboundDeliveryRepository,
    senderCalls,
    setSenderFailure(value: boolean) { fail = value; },
    messageRepository,
    commercialEventRepository,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    },
  };
};

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
