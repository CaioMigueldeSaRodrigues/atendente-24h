import type { DatabaseSync } from "node:sqlite";
import { Channel, CommercialEventType, CommercialOutcome, ConversationStatus, Intent, InventoryAvailability, OpportunityStatus, OutboundDeliveryStatus, QuoteRequestStatus, SenderType } from "../core/domain/enums.js";
import { SqliteAmpliviewAdminReadModel } from "../infrastructure/sqlite/sqlite-ampliview-admin-read-model.js";
import { createSqliteDatabase } from "../infrastructure/sqlite/sqlite-database.js";
import { PreviewAdminBusinessScopeAuthorizer } from "./preview-admin-authorizer.js";

export const PREVIEW_ADMIN_BUSINESS_ID = "preview-business";

export type PreviewAdminDependencies = {
  database: DatabaseSync;
  adminQueryService: SqliteAmpliviewAdminReadModel;
  adminBusinessScopeAuthorizer: PreviewAdminBusinessScopeAuthorizer;
};

function insert(database: DatabaseSync, sql: string, ...values: any[]): void {
  database.prepare(sql).run(...values);
}

function seedConversation(database: DatabaseSync, input: {
  suffix: string;
  customerName: string;
  phone?: string;
  email?: string;
  brand?: string;
  model?: string;
  year?: number;
  version?: string;
  plate?: string;
  mileage?: number;
  conversationStatus: ConversationStatus;
  quoteStatus: QuoteRequestStatus;
  quotePriceCents?: number;
  respondedAt?: string;
  publishedAt?: string;
  deliveryStatus?: OutboundDeliveryStatus;
  deliveryError?: string;
  deliveryAt?: string;
  intent: Intent;
  requestDescription: string;
  lastMessageAt: string;
}): void {
  const businessId = PREVIEW_ADMIN_BUSINESS_ID;
  const base = "2026-09-29T10:00:00.000Z";
  const customerId = `${businessId}-customer-${input.suffix}`;
  const vehicleId = `${businessId}-vehicle-${input.suffix}`;
  const conversationId = `${businessId}-conversation-${input.suffix}`;
  const opportunityId = `${businessId}-opportunity-${input.suffix}`;
  const quoteId = `${businessId}-quote-${input.suffix}`;
  const messageId = `${conversationId}-assistant`;

  insert(database, "INSERT INTO customers(id,business_id,name,primary_phone,email,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", customerId, businessId, input.customerName, input.phone ?? null, input.email ?? null, base, base);
  insert(database, "INSERT INTO vehicles(id,business_id,customer_id,brand,model,year,version,license_plate,mileage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", vehicleId, businessId, customerId, input.brand ?? null, input.model ?? null, input.year ?? null, input.version ?? null, input.plate ?? null, input.mileage ?? null, base, base);
  insert(database, "INSERT INTO conversations(id,business_id,customer_id,vehicle_id,channel,status,commercial_outcome,current_intent,started_at,last_message_at) VALUES(?,?,?,?,?,?,?,?,?,?)", conversationId, businessId, customerId, vehicleId, Channel.WHATSAPP, input.conversationStatus, CommercialOutcome.QUOTE_REQUESTED, input.intent, base, input.lastMessageAt);
  insert(database, "INSERT INTO opportunities(id,business_id,conversation_id,customer_id,vehicle_id,request_description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", opportunityId, businessId, conversationId, customerId, vehicleId, input.requestDescription, input.quoteStatus === QuoteRequestStatus.WAITING_BUSINESS ? OpportunityStatus.WAITING_BUSINESS : OpportunityStatus.WAITING_CUSTOMER, base, input.lastMessageAt);
  insert(database, "INSERT INTO quote_requests(id,business_id,opportunity_id,conversation_id,customer_id,vehicle_id,request_description,symptom_description,status,requested_at,responded_at,authorized_price_amount_cents,authorized_price_currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", quoteId, businessId, opportunityId, conversationId, customerId, vehicleId, input.requestDescription, null, input.quoteStatus, base, input.respondedAt ?? null, input.quotePriceCents ?? null, input.quotePriceCents === undefined ? null : "BRL", base, input.lastMessageAt);
  insert(database, "INSERT INTO messages(id,business_id,conversation_id,sender_type,channel,content,created_at) VALUES(?,?,?,?,?,?,?)", `${conversationId}-customer`, businessId, conversationId, SenderType.CUSTOMER, Channel.WHATSAPP, `Olá, gostaria de ${input.requestDescription.toLowerCase()}.`, base);
  insert(database, "INSERT INTO messages(id,business_id,conversation_id,sender_type,channel,content,created_at) VALUES(?,?,?,?,?,?,?)", messageId, businessId, conversationId, SenderType.ASSISTANT, Channel.WHATSAPP, "Vou verificar as informações para você.", input.lastMessageAt);
  insert(database, "INSERT INTO commercial_events(id,business_id,event_type,conversation_id,customer_id,vehicle_id,opportunity_id,quote_request_id,channel,intent,requested_item,vehicle_brand,vehicle_model,vehicle_year,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", `${quoteId}-requested`, businessId, CommercialEventType.QUOTE_REQUESTED, conversationId, customerId, vehicleId, opportunityId, quoteId, Channel.WHATSAPP, input.intent, input.requestDescription, input.brand ?? null, input.model ?? null, input.year ?? null, base);
  if (input.respondedAt && input.quotePriceCents !== undefined) {
    insert(database, "INSERT INTO commercial_events(id,business_id,event_type,conversation_id,customer_id,vehicle_id,opportunity_id,quote_request_id,channel,intent,requested_item,vehicle_brand,vehicle_model,vehicle_year,amount_cents,currency,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", `${quoteId}-responded`, businessId, CommercialEventType.QUOTE_RESPONDED, conversationId, customerId, vehicleId, opportunityId, quoteId, Channel.WHATSAPP, input.intent, input.requestDescription, input.brand ?? null, input.model ?? null, input.year ?? null, input.quotePriceCents, "BRL", input.respondedAt);
  }
  if (input.publishedAt && input.quotePriceCents !== undefined) {
    insert(database, "INSERT INTO commercial_events(id,business_id,event_type,conversation_id,customer_id,vehicle_id,opportunity_id,quote_request_id,channel,intent,requested_item,vehicle_brand,vehicle_model,vehicle_year,amount_cents,currency,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", `${quoteId}-published`, businessId, CommercialEventType.QUOTE_PUBLISHED, conversationId, customerId, vehicleId, opportunityId, quoteId, Channel.WHATSAPP, input.intent, input.requestDescription, input.brand ?? null, input.model ?? null, input.year ?? null, input.quotePriceCents, "BRL", input.publishedAt);
  }
  if (input.deliveryStatus) {
    insert(database, "INSERT INTO outbound_deliveries(id,business_id,message_id,quote_request_id,conversation_id,channel,recipient_ref,status,attempts,last_error,created_at,updated_at,delivered_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", `${quoteId}-delivery`, businessId, messageId, quoteId, conversationId, Channel.WHATSAPP, input.phone ?? null, input.deliveryStatus, input.deliveryStatus === OutboundDeliveryStatus.DELIVERED ? 1 : 2, input.deliveryError ?? null, input.publishedAt ?? input.lastMessageAt, input.lastMessageAt, input.deliveryAt ?? null);
  }
}

export function createPreviewAdminDependencies(): PreviewAdminDependencies {
  const database = createSqliteDatabase({ filename: ":memory:" });
  const businessId = PREVIEW_ADMIN_BUSINESS_ID;
  insert(database, "INSERT INTO automotive_businesses(id,name,business_type,timezone,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", businessId, "Oficina Preview", "WORKSHOP", "America/Sao_Paulo", 1, "2026-09-29T00:00:00.000Z", "2026-09-29T00:00:00.000Z");

  seedConversation(database, {
    suffix: "waiting",
    customerName: "Ana Souza",
    phone: "5511999990001",
    brand: "Toyota",
    model: "Corolla",
    year: 2021,
    version: "XEi",
    plate: "ABC1D23",
    mileage: 48200,
    conversationStatus: ConversationStatus.ACTIVE,
    quoteStatus: QuoteRequestStatus.WAITING_BUSINESS,
    intent: Intent.QUOTE_REQUEST,
    requestDescription: "troca de óleo",
    lastMessageAt: "2026-09-29T10:05:00.000Z",
  });
  seedConversation(database, {
    suffix: "responded",
    customerName: "Bruno Lima",
    phone: "5511999990002",
    email: "bruno@example.test",
    brand: "Chevrolet",
    model: "Onix",
    year: 2020,
    version: "LT",
    plate: "DEF4E56",
    mileage: 62000,
    conversationStatus: ConversationStatus.WAITING_CUSTOMER,
    quoteStatus: QuoteRequestStatus.RESPONDED,
    quotePriceCents: 65000,
    respondedAt: "2026-09-29T10:20:00.000Z",
    intent: Intent.SERVICE_INQUIRY,
    requestDescription: "revisão de freios",
    lastMessageAt: "2026-09-29T10:20:00.000Z",
  });
  seedConversation(database, {
    suffix: "delivered",
    customerName: "Carla Mendes",
    phone: "5511999990003",
    email: "carla@example.test",
    brand: "Honda",
    model: "Civic",
    year: 2019,
    version: "Touring",
    plate: "GHI7F89",
    mileage: 71500,
    conversationStatus: ConversationStatus.WAITING_CUSTOMER,
    quoteStatus: QuoteRequestStatus.RESPONDED,
    quotePriceCents: 125000,
    respondedAt: "2026-09-29T10:15:00.000Z",
    publishedAt: "2026-09-29T10:25:00.000Z",
    deliveryStatus: OutboundDeliveryStatus.DELIVERED,
    deliveryAt: "2026-09-29T10:26:00.000Z",
    intent: Intent.QUOTE_REQUEST,
    requestDescription: "troca de pastilhas",
    lastMessageAt: "2026-09-29T10:26:00.000Z",
  });
  seedConversation(database, {
    suffix: "failed",
    customerName: "Diego Alves",
    brand: "Ford",
    model: "Ka",
    conversationStatus: ConversationStatus.ACTIVE,
    quoteStatus: QuoteRequestStatus.RESPONDED,
    quotePriceCents: 89000,
    respondedAt: "2026-09-29T10:18:00.000Z",
    publishedAt: "2026-09-29T10:24:00.000Z",
    deliveryStatus: OutboundDeliveryStatus.FAILED_RETRYABLE,
    deliveryError: "Provedor temporariamente indisponível",
    intent: Intent.QUOTE_REQUEST,
    requestDescription: "alinhamento",
    lastMessageAt: "2026-09-29T10:24:00.000Z",
  });

  const stockChecks = [
    ["waiting", InventoryAvailability.AVAILABLE, 8, "unidade"],
    ["responded", InventoryAvailability.LOW_STOCK, 2, "unidade"],
    ["delivered", InventoryAvailability.OUT_OF_STOCK, 0, "unidade"],
    ["failed", InventoryAvailability.UNKNOWN, null, null],
  ] as const;
  for (const [suffix, availability, quantity, unit] of stockChecks) {
    insert(database, "INSERT INTO stock_checks(id,business_id,conversation_id,quote_request_id,vehicle_id,requested_item,inventory_reference,availability,available_quantity,unit,source,checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      `${businessId}-stock-check-${suffix}`, businessId, `${businessId}-conversation-${suffix}`, `${businessId}-quote-${suffix}`, `${businessId}-vehicle-${suffix}`,
      ({ waiting: "troca de óleo", responded: "revisão de freios", delivered: "troca de pastilhas", failed: "alinhamento" } as Record<string, string>)[suffix],
      `${businessId}-inventory-${suffix}`, availability, quantity, unit, "local-fixture", "2026-09-29T10:30:00.000Z");
  }

  return {
    database,
    adminQueryService: new SqliteAmpliviewAdminReadModel(database),
    adminBusinessScopeAuthorizer: new PreviewAdminBusinessScopeAuthorizer(new Set([businessId])),
  };
}
