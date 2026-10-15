import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Conversation, Opportunity, QuoteRequest } from "../../src/core/domain/entities.js";
import { AppointmentStatus, BusinessType, Channel, CommercialOutcome, ConversationStatus, Intent, OpportunityStatus, OutboundDeliveryStatus, QuoteRequestStatus } from "../../src/core/domain/enums.js";
import { processMessage } from "../../src/core/process-message.js";
import { InMemoryAppointmentRepository, InMemoryCommercialEventRepository, InMemoryConversationRepository, InMemoryCustomerRepository, InMemoryHumanHandoffRepository, InMemoryMessageRepository, InMemoryOpportunityRepository, InMemoryOutboundDeliveryRepository, InMemoryQuoteRequestRepository, InMemoryVehicleRepository } from "../../src/core/in-memory-repositories.js";
import { createBasicPlanHttpServer } from "../../src/infrastructure/http/basic-plan-http-server.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";
import { withSqliteTransaction } from "../../src/infrastructure/sqlite/sqlite-connection-lock.js";

const timestamp = "2026-10-14T12:00:00.000Z";

test("accepted quote creates a visible appointment request and confirmation is independent and idempotent", async () => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  const conversationRepository = new InMemoryConversationRepository();
  const appointmentRepository = new InMemoryAppointmentRepository();
  const customerRepository = new InMemoryCustomerRepository();
  const vehicleRepository = new InMemoryVehicleRepository();
  const messageRepository = new InMemoryMessageRepository();
  const opportunityRepository = new InMemoryOpportunityRepository();
  const quoteRequestRepository = new InMemoryQuoteRequestRepository();
  const outboundDeliveryRepository = new InMemoryOutboundDeliveryRepository();
  const commercialEventRepository = new InMemoryCommercialEventRepository();
  const humanHandoffRepository = new InMemoryHumanHandoffRepository();
  const businessId = "business-appointment";
  const conversation: Conversation = {
    id: "conversation-appointment",
    businessId,
    channel: Channel.WHATSAPP,
    status: ConversationStatus.ACTIVE,
    commercialOutcome: CommercialOutcome.QUOTE_REQUESTED,
    startedAt: timestamp,
    lastMessageAt: timestamp,
  };
  const link = {
    businessId,
    instanceName: "instance-appointment",
    senderJid: "5511999990000@s.whatsapp.net",
    conversationId: conversation.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const opportunity: Opportunity = {
    id: "opportunity-appointment",
    businessId,
    conversationId: conversation.id,
    requestDescription: "Troca de óleo",
    status: OpportunityStatus.WAITING_CUSTOMER,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const quote: QuoteRequest = {
    id: "quote-appointment",
    businessId,
    opportunityId: opportunity.id,
    conversationId: conversation.id,
    requestDescription: "Troca de óleo",
    status: QuoteRequestStatus.RESPONDED,
    requestedAt: timestamp,
    respondedAt: timestamp,
    authorizedPrice: { amountCents: 30000, currency: "BRL" },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await conversationRepository.save(conversation);
  await opportunityRepository.save(opportunity);
  await quoteRequestRepository.save(quote);
  await outboundDeliveryRepository.reserve({
    id: "quote-delivery",
    businessId,
    quoteRequestId: quote.id,
    conversationId: conversation.id,
    channel: Channel.WHATSAPP,
    recipientRef: "5511999990000@s.whatsapp.net",
    messageId: "quote-message",
    status: OutboundDeliveryStatus.DELIVERED,
    attempts: 1,
    providerMessageId: "provider-quote",
    createdAt: timestamp,
    updatedAt: timestamp,
    deliveredAt: timestamp,
  });
  let sequence = 0;
  let clock = 0;
  const appointmentResponse = await processMessage({ businessId, conversationId: conversation.id, content: "Sim" }, {
    conversationRepository,
    appointmentRepository,
    messageRepository,
    customerRepository,
    vehicleRepository,
    humanHandoffRepository,
    opportunityRepository,
    quoteRequestRepository,
    interpreter: { interpret: async () => ({
      intent: Intent.APPOINTMENT_REQUEST,
      extractedCustomerData: {},
      extractedVehicleData: {},
      missingData: [],
      suggestedNextAction: { type: "REQUEST_INFORMATION", description: "Aguardar confirmação da oficina" },
      requiresHuman: false,
      proposedResponse: "Solicitação de agendamento registrada. O horário ainda precisa ser confirmado pela equipe.",
    }) },
    commercialEventRepository,
    now: () => new Date(Date.parse(timestamp) + clock++).toISOString(),
    generateId: (prefix) => `${prefix}-${++sequence}`,
  });
  assert.equal(appointmentResponse.intent, Intent.APPOINTMENT_REQUEST);
  const pendingAppointments = await appointmentRepository.listByConversation(businessId, conversation.id);
  assert.equal(pendingAppointments.length, 1);
  assert.equal(pendingAppointments[0]?.status, AppointmentStatus.REQUESTED);
  assert.equal(pendingAppointments[0]?.requestDescription, "Troca de óleo");
  const pendingAppointment = pendingAppointments[0]!;
  const unrelatedQuote: QuoteRequest = {
    id: "quote-old-published",
    businessId,
    opportunityId: "opportunity-unrelated",
    conversationId: conversation.id,
    requestDescription: "Servico antigo ja publicado",
    status: QuoteRequestStatus.RESPONDED,
    requestedAt: timestamp,
    respondedAt: timestamp,
    authorizedPrice: { amountCents: 25000, currency: "BRL" },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await quoteRequestRepository.save(unrelatedQuote);
  await outboundDeliveryRepository.reserve({
    id: "old-quote-delivery",
    businessId,
    quoteRequestId: unrelatedQuote.id,
    conversationId: conversation.id,
    channel: Channel.WHATSAPP,
    recipientRef: "5511999990000@s.whatsapp.net",
    messageId: "old-quote-message",
    status: OutboundDeliveryStatus.DELIVERED,
    attempts: 1,
    providerMessageId: "provider-old-quote",
    createdAt: timestamp,
    updatedAt: timestamp,
    deliveredAt: timestamp,
  });
  const newQuote: QuoteRequest = {
    id: "quote-new",
    businessId,
    opportunityId: "opportunity-new",
    conversationId: conversation.id,
    requestDescription: "Servico novo",
    status: QuoteRequestStatus.RESPONDED,
    requestedAt: timestamp,
    respondedAt: timestamp,
    authorizedPrice: { amountCents: 18000, currency: "BRL" },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await quoteRequestRepository.save(newQuote);

  const sent: Array<{ recipientJid: string; content: string }> = [];
  const linkRepository = {
    runAtomically: async <T>(_key: unknown, operation: () => Promise<T>) => operation(),
    findBySender: async () => link,
    findByConversation: async () => link,
    save: async () => undefined,
  };
  const server = createBasicPlanHttpServer({
    conversationRepository,
    messageRepository,
    customerRepository,
    vehicleRepository,
    opportunityRepository,
    quoteRequestRepository,
    outboundDeliveryRepository,
    appointmentRepository,
    humanHandoffRepository,
    commercialEventRepository,
    evolutionGoConversationLinkRepository: linkRepository,
    evolutionGoWebhookTransaction: { run: (operation) => withSqliteTransaction(database, operation) },
    channelTextSenders: {
      [Channel.WHATSAPP]: { sendText: async (message) => { sent.push(message); return { providerMessageId: "provider-appointment" }; } },
    },
    operator: { businessId, businessName: "Oficina Appointment" },
    businessOperatorAuthorizer: { isAuthorized: async ({ businessId: requested }) => requested === businessId },
    interpreter: { interpret: async () => { throw new Error("not used"); } },
    now: () => new Date(Date.parse(timestamp) + clock++).toISOString(),
    generateId: (prefix) => `${prefix}-server-${++sequence}`,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, init?: RequestInit) => fetch(`${base}${path}`, init);
  try {
    const pendingResponse = await request(`/v1/businesses/${businessId}/quotes/pending`);
    assert.equal(pendingResponse.status, 200);
    const pending = await pendingResponse.json() as { items: Array<{ quote: QuoteRequest; quoteActionable: boolean; appointment: typeof pendingAppointment | null; appointmentDelivery: unknown; contactLabel?: string }> };
    assert.equal(pending.items.length, 2);
    const pendingAppointmentItem = pending.items.find((item) => item.quote.id === quote.id)!;
    const newQuoteItem = pending.items.find((item) => item.quote.id === newQuote.id)!;
    assert.equal(pendingAppointmentItem.appointment?.id, pendingAppointment.id);
    assert.equal(pendingAppointmentItem.appointment?.status, AppointmentStatus.REQUESTED);
    assert.equal(pendingAppointmentItem.appointment?.requestDescription, "Troca de óleo");
    assert.equal(pendingAppointmentItem.quote.authorizedPrice?.amountCents, 30000);
    assert.equal(pendingAppointmentItem.quoteActionable, false);
    assert.equal(pendingAppointmentItem.appointmentDelivery, null);
    assert.equal(pendingAppointmentItem.contactLabel, "WhatsApp •••• 0000");
    assert.equal(newQuoteItem.appointment, null);
    assert.equal(newQuoteItem.quoteActionable, true);
    assert.doesNotMatch(JSON.stringify(pending), /5511999990000@s\.whatsapp\.net/);

    const operator = await request("/operator");
    assert.equal(operator.status, 200);
    const operatorHtml = await operator.text();
    assert.match(operatorHtml, /SOLICITA/);
    assert.match(operatorHtml, /Confirmar agendamento/);
    assert.match(operatorHtml, /Enviar or/);
    assert.match(operatorHtml, /item\.quoteActionable === true/);
    assert.match(operatorHtml, /Orçamento já enviado ao cliente/);

    const stale = await request(`/v1/businesses/${businessId}/appointments/${pendingAppointment.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "wrong-conversation", quoteRequestId: quote.id, appointmentUpdatedAt: pendingAppointment.updatedAt, date: "2026-10-20", time: "14:30" }),
    });
    assert.equal(stale.status, 409);

    const confirmed = await request(`/v1/businesses/${businessId}/appointments/${pendingAppointment.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: conversation.id, quoteRequestId: quote.id, appointmentUpdatedAt: pendingAppointment.updatedAt, date: "2026-10-20", time: "14:30" }),
    });
    assert.equal(confirmed.status, 200);
    const confirmedBody = await confirmed.json() as { appointment: { status: string; requestedDate: string; requestedTime: string }; delivery: { status: string } };
    assert.equal(confirmedBody.appointment.status, AppointmentStatus.CONFIRMED);
    assert.equal(confirmedBody.appointment.requestedDate, "2026-10-20");
    assert.equal(confirmedBody.appointment.requestedTime, "14:30");
    assert.equal(confirmedBody.delivery.status, "DELIVERED");
    assert.deepEqual(sent, [{ recipientJid: "5511999990000@s.whatsapp.net", content: "Agendamento confirmado para 20/10/2026 às 14:30." }]);

    const appointmentDelivery = await outboundDeliveryRepository.findByAppointmentAndChannel(businessId, pendingAppointment.id, Channel.WHATSAPP);
    const quoteDelivery = await outboundDeliveryRepository.findByQuoteRequestAndChannel(businessId, quote.id, Channel.WHATSAPP);
    assert.equal(appointmentDelivery?.providerMessageId, "provider-appointment");
    assert.equal(appointmentDelivery?.status, OutboundDeliveryStatus.DELIVERED);
    assert.equal(quoteDelivery?.providerMessageId, "provider-quote");
    assert.notEqual(appointmentDelivery?.id, quoteDelivery?.id);

    const reloadQueue = await request(`/v1/businesses/${businessId}/quotes/pending`);
    const reloaded = await reloadQueue.json() as { items: Array<{ quote: QuoteRequest; appointment: typeof pendingAppointment }> };
    const reloadedAppointmentItem = reloaded.items.find((item) => item.quote.id === quote.id)!;
    assert.equal(reloadedAppointmentItem.appointment.status, AppointmentStatus.CONFIRMED);
    assert.equal(reloadedAppointmentItem.appointment.requestedDate, "2026-10-20");

    const retry = await request(`/v1/businesses/${businessId}/appointments/${pendingAppointment.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: conversation.id, quoteRequestId: quote.id, appointmentUpdatedAt: reloadedAppointmentItem.appointment.updatedAt, date: "2026-10-20", time: "14:30" }),
    });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json() as { delivery: { status: string } }).delivery.status, "ALREADY_DELIVERED");
    assert.equal(sent.length, 1);

    const wrongTenant = await request(`/v1/businesses/other-business/appointments/${pendingAppointment.id}/confirm`, { method: "POST" });
    assert.equal(wrongTenant.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});
