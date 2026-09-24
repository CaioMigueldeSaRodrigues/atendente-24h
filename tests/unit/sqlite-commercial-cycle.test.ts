import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import type { AutomotiveBusiness, Conversation } from "../../src/core/domain/entities.js";
import {
  BusinessType,
  Channel,
  CommercialOutcome,
  ConversationStatus,
  Intent,
  OpportunityStatus,
  QuoteRequestStatus,
  SenderType,
} from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import type { MessageInterpreter } from "../../src/core/message-interpreter.js";
import { processMessage } from "../../src/core/process-message.js";
import { respondToQuote } from "../../src/core/respond-to-quote.js";
import { publishAuthorizedQuote } from "../../src/core/publish-authorized-quote.js";
import { canPresentAuthorizedPrice } from "../../src/core/business-rules.js";
import { buildAuthorizedQuoteReply } from "../../src/core/quote-presentation.js";
import {
  InMemoryAppointmentRepository,
  InMemoryHumanHandoffRepository,
} from "../../src/core/in-memory-repositories.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteCustomerRepository } from "../../src/infrastructure/sqlite/sqlite-customer-repository.js";
import { SqliteMessageRepository } from "../../src/infrastructure/sqlite/sqlite-message-repository.js";
import { SqliteOpportunityRepository } from "../../src/infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteQuoteRequestRepository } from "../../src/infrastructure/sqlite/sqlite-quote-request-repository.js";
import { SqliteVehicleRepository } from "../../src/infrastructure/sqlite/sqlite-vehicle-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";

const business = (id: string, name: string): AutomotiveBusiness => ({
  id,
  name,
  businessType: BusinessType.WORKSHOP,
  timezone: "America/Sao_Paulo",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const initialConversation = (businessId: string): Conversation => ({
  id: "conversation-1",
  businessId,
  channel: Channel.WEB,
  status: ConversationStatus.ACTIVE,
  startedAt: "2026-01-01T09:00:00.000Z",
  lastMessageAt: "2026-01-01T09:00:00.000Z",
});

const interpretation: AIInterpretation = {
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: { name: "Carlos" },
  extractedVehicleData: {
    brand: "Toyota",
    model: "Corolla",
    year: 2020,
    version: "XEi",
  },
  requestedItem: "Pastilhas de freio",
  missingData: [],
  suggestedNextAction: {
    type: "PROVIDE_QUOTE",
    description: "Preparar orçamento para as pastilhas de freio",
  },
  requiresHuman: false,
  proposedResponse: "Vamos verificar o orçamento solicitado.",
};

const interpreter: MessageInterpreter = {
  async interpret() {
    return interpretation;
  },
};

type SqliteRepositories = {
  automotiveBusinessRepository: SqliteAutomotiveBusinessRepository;
  customerRepository: SqliteCustomerRepository;
  vehicleRepository: SqliteVehicleRepository;
  conversationRepository: SqliteConversationRepository;
  messageRepository: SqliteMessageRepository;
  opportunityRepository: SqliteOpportunityRepository;
  quoteRequestRepository: SqliteQuoteRequestRepository;
};

function createRepositories(database: DatabaseSync): SqliteRepositories {
  return {
    automotiveBusinessRepository: new SqliteAutomotiveBusinessRepository(database),
    customerRepository: new SqliteCustomerRepository(database),
    vehicleRepository: new SqliteVehicleRepository(database),
    conversationRepository: new SqliteConversationRepository(database),
    messageRepository: new SqliteMessageRepository(database),
    opportunityRepository: new SqliteOpportunityRepository(database),
    quoteRequestRepository: new SqliteQuoteRequestRepository(database),
  };
}

function countRows(database: DatabaseSync, table: "customers" | "vehicles" | "conversations") {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count;
}

test("completes and recovers the commercial quote cycle across SQLite restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "atendente-commercial-cycle-"));
  const filename = join(directory, "atendente-commercial-cycle.db");
  let database: DatabaseSync | undefined;
  let repositories: SqliteRepositories | undefined;
  let idCounters: Record<string, number> = {};
  let clockSeconds = 0;
  let publishedAt = "";
  const now = () => {
    const value = new Date(Date.UTC(2026, 0, 1, 10, 0, clockSeconds++)).toISOString();
    return value;
  };
  const generateId = (prefix: string) => {
    idCounters[prefix] = (idCounters[prefix] ?? 0) + 1;
    return `${prefix}-${idCounters[prefix]}`;
  };
  const open = () => {
    database = createSqliteDatabase({ filename });
    repositories = createRepositories(database);
  };
  const close = () => {
    repositories = undefined;
    database?.close();
    database = undefined;
  };

  try {
    open();
    assert.ok(database && repositories);
    await repositories.automotiveBusinessRepository.save(
      business("business-a", "Oficina Carlos"),
    );
    await repositories.automotiveBusinessRepository.save(
      business("business-b", "Outra oficina"),
    );
    await repositories.conversationRepository.save(initialConversation("business-a"));

    const processResult = await processMessage(
      {
        businessId: "business-a",
        conversationId: "conversation-1",
        content: "Meu nome é Carlos. Tenho um Toyota Corolla XEi 2020 e quero orçamento para trocar as pastilhas de freio.",
      },
      {
        conversationRepository: repositories.conversationRepository,
        appointmentRepository: new InMemoryAppointmentRepository(),
        messageRepository: repositories.messageRepository,
        customerRepository: repositories.customerRepository,
        vehicleRepository: repositories.vehicleRepository,
        humanHandoffRepository: new InMemoryHumanHandoffRepository(),
        opportunityRepository: repositories.opportunityRepository,
        quoteRequestRepository: repositories.quoteRequestRepository,
        interpreter,
        now,
        generateId,
      },
    );

    assert.equal(processResult.requiresHuman, false);
    const conversationAfterProcess = await repositories.conversationRepository.findById(
      "business-a",
      "conversation-1",
    );
    assert.ok(conversationAfterProcess?.customerId);
    assert.ok(conversationAfterProcess?.vehicleId);
    assert.equal(conversationAfterProcess.businessId, "business-a");

    const customer = await repositories.customerRepository.findById(
      "business-a",
      conversationAfterProcess.customerId,
    );
    assert.equal(customer?.name, "Carlos");
    const vehicle = await repositories.vehicleRepository.findById(
      "business-a",
      conversationAfterProcess.vehicleId,
    );
    assert.deepEqual(
      {
        brand: vehicle?.brand,
        model: vehicle?.model,
        version: vehicle?.version,
        year: vehicle?.year,
        customerId: vehicle?.customerId,
      },
      {
        brand: "Toyota",
        model: "Corolla",
        version: "XEi",
        year: 2020,
        customerId: customer?.id,
      },
    );

    const opportunitiesAfterProcess = await repositories.opportunityRepository.listByConversation(
      "business-a",
      "conversation-1",
    );
    assert.equal(opportunitiesAfterProcess.length, 1);
    assert.equal(opportunitiesAfterProcess[0]?.businessId, "business-a");
    assert.equal(opportunitiesAfterProcess[0]?.requestDescription, "Pastilhas de freio");
    assert.equal(opportunitiesAfterProcess[0]?.status, OpportunityStatus.WAITING_BUSINESS);
    const quoteRequestsAfterProcess = await repositories.quoteRequestRepository.listByConversation(
      "business-a",
      "conversation-1",
    );
    assert.equal(quoteRequestsAfterProcess.length, 1);
    assert.equal(quoteRequestsAfterProcess[0]?.opportunityId, opportunitiesAfterProcess[0]?.id);
    assert.equal(quoteRequestsAfterProcess[0]?.status, QuoteRequestStatus.WAITING_BUSINESS);
    assert.equal(quoteRequestsAfterProcess[0]?.authorizedPrice, undefined);

    const messagesAfterProcess = await repositories.messageRepository.listByConversation(
      "business-a",
      "conversation-1",
    );
    assert.ok(messagesAfterProcess.some((message) => message.senderType === SenderType.CUSTOMER && message.content.includes("pastilhas de freio")));
    assert.ok(messagesAfterProcess.some((message) => message.senderType === SenderType.ASSISTANT && message.content === processResult.reply));

    close();

    // First restart: repositories are new instances over the same on-disk database.
    open();
    assert.ok(database && repositories);
    const quoteAfterFirstRestart = (await repositories.quoteRequestRepository.listByConversation(
      "business-a",
      "conversation-1",
    ))[0];
    assert.ok(quoteAfterFirstRestart);
    const restartedConversation = await repositories.conversationRepository.findById(
      "business-a",
      "conversation-1",
    );
    assert.ok(restartedConversation?.customerId);
    assert.ok(restartedConversation?.vehicleId);
    assert.ok(await repositories.customerRepository.findById("business-a", restartedConversation.customerId));
    assert.ok(await repositories.vehicleRepository.findById("business-a", restartedConversation.vehicleId));
    assert.ok(await repositories.opportunityRepository.findById("business-a", quoteAfterFirstRestart.opportunityId));
    assert.equal((await repositories.messageRepository.listByConversation("business-a", "conversation-1")).length, 2);

    await respondToQuote(
      {
        businessId: "business-a",
        quoteRequestId: quoteAfterFirstRestart.id,
        authorizedPrice: { amountCents: 65000, currency: "BRL" },
      },
      {
        quoteRequestRepository: repositories.quoteRequestRepository,
        opportunityRepository: repositories.opportunityRepository,
        now,
      },
    );

    const quoteAfterResponse = await repositories.quoteRequestRepository.findById(
      "business-a",
      quoteAfterFirstRestart.id,
    );
    assert.ok(quoteAfterResponse);
    assert.equal(quoteAfterResponse?.status, QuoteRequestStatus.RESPONDED);
    assert.deepEqual(quoteAfterResponse?.authorizedPrice, { amountCents: 65000, currency: "BRL" });
    assert.equal(canPresentAuthorizedPrice(quoteAfterResponse), true);
    const opportunityAfterResponse = await repositories.opportunityRepository.findById(
      "business-a",
      quoteAfterFirstRestart.opportunityId,
    );
    assert.equal(opportunityAfterResponse?.status, OpportunityStatus.WAITING_CUSTOMER);
    assert.deepEqual(opportunityAfterResponse?.nextAction, {
      type: "REQUEST_INFORMATION",
      description: "Aguardar a decisão do cliente sobre o orçamento",
    });

    close();

    // Second restart: verify response state before publishing.
    open();
    assert.ok(database && repositories);
    const quoteAfterSecondRestart = await repositories.quoteRequestRepository.findById(
      "business-a",
      quoteAfterFirstRestart.id,
    );
    assert.equal(quoteAfterSecondRestart?.status, QuoteRequestStatus.RESPONDED);
    assert.deepEqual(quoteAfterSecondRestart?.authorizedPrice, { amountCents: 65000, currency: "BRL" });
    const opportunityAfterSecondRestart = await repositories.opportunityRepository.findById(
      "business-a",
      quoteAfterFirstRestart.opportunityId,
    );
    assert.equal(opportunityAfterSecondRestart?.status, OpportunityStatus.WAITING_CUSTOMER);
    assert.ok(quoteAfterSecondRestart);

    const publishResult = await publishAuthorizedQuote(
      { businessId: "business-a", quoteRequestId: quoteAfterSecondRestart.id },
      {
        quoteRequestRepository: repositories.quoteRequestRepository,
        conversationRepository: repositories.conversationRepository,
        messageRepository: repositories.messageRepository,
        generateId,
        now: () => {
          publishedAt = now();
          return publishedAt;
        },
      },
    );
    assert.equal(
      publishResult.content,
      buildAuthorizedQuoteReply(quoteAfterSecondRestart),
    );
    const publishedMessages = await repositories.messageRepository.listByConversation(
      "business-a",
      "conversation-1",
    );
    const publishedMessage = publishedMessages.find((message) => message.id === publishResult.messageId);
    assert.ok(publishedMessage);
    assert.equal(publishedMessage.senderType, SenderType.ASSISTANT);
    assert.equal(publishedMessage.channel, Channel.WEB);
    assert.equal(publishedMessage.content, publishResult.content);
    const conversationAfterPublish = await repositories.conversationRepository.findById(
      "business-a",
      "conversation-1",
    );
    assert.equal(conversationAfterPublish?.lastMessageAt, publishedAt);
    const quoteAfterPublish = await repositories.quoteRequestRepository.findById(
      "business-a",
      quoteAfterSecondRestart.id,
    );
    assert.equal(quoteAfterPublish?.status, QuoteRequestStatus.RESPONDED);
    assert.deepEqual(quoteAfterPublish?.authorizedPrice, { amountCents: 65000, currency: "BRL" });

    close();

    // Third restart: all final state is read from newly opened SQLite repositories.
    open();
    assert.ok(database && repositories);
    assert.equal(countRows(database, "customers"), 1);
    assert.equal(countRows(database, "vehicles"), 1);
    assert.equal(countRows(database, "conversations"), 1);

    const finalConversation = await repositories.conversationRepository.findById("business-a", "conversation-1");
    assert.ok(finalConversation);
    assert.equal(finalConversation.businessId, "business-a");
    assert.equal(finalConversation.lastMessageAt, publishedAt);
    const finalCustomer = await repositories.customerRepository.findById("business-a", finalConversation.customerId!);
    assert.equal(finalCustomer?.name, "Carlos");
    const finalVehicle = await repositories.vehicleRepository.findById("business-a", finalConversation.vehicleId!);
    assert.equal(finalVehicle?.brand, "Toyota");
    assert.equal(finalVehicle?.model, "Corolla");
    assert.equal(finalVehicle?.year, 2020);
    const finalOpportunities = await repositories.opportunityRepository.listByConversation("business-a", "conversation-1");
    assert.equal(finalOpportunities.length, 1);
    assert.equal(finalOpportunities[0]?.status, OpportunityStatus.WAITING_CUSTOMER);
    const finalQuoteRequests = await repositories.quoteRequestRepository.listByConversation("business-a", "conversation-1");
    assert.equal(finalQuoteRequests.length, 1);
    assert.equal(finalQuoteRequests[0]?.status, QuoteRequestStatus.RESPONDED);
    assert.deepEqual(finalQuoteRequests[0]?.authorizedPrice, { amountCents: 65000, currency: "BRL" });

    const finalMessages = await repositories.messageRepository.listByConversation("business-a", "conversation-1");
    assert.ok(finalMessages.some((message) => message.senderType === SenderType.CUSTOMER && message.content.includes("pastilhas de freio")));
    assert.ok(finalMessages.some((message) => message.senderType === SenderType.ASSISTANT && message.content === processResult.reply));
    assert.ok(finalMessages.some((message) => message.id === publishResult.messageId && message.content === publishResult.content));

    assert.equal(await repositories.customerRepository.findById("business-b", finalCustomer!.id), null);
    assert.equal(await repositories.vehicleRepository.findById("business-b", finalVehicle!.id), null);
    assert.equal(await repositories.conversationRepository.findById("business-b", finalConversation.id), null);
    assert.deepEqual(await repositories.messageRepository.listByConversation("business-b", "conversation-1"), []);
    assert.deepEqual(await repositories.opportunityRepository.listByConversation("business-b", "conversation-1"), []);
    assert.deepEqual(await repositories.quoteRequestRepository.listByConversation("business-b", "conversation-1"), []);
  } finally {
    close();
    await rm(directory, { recursive: true, force: true });
  }
});
