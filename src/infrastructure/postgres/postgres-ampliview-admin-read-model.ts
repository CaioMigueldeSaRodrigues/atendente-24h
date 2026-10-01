import type { PostgresDatabase } from "./postgres-database.js";
import type { AdminConversationDetail, AdminConversationList, AdminConversationListFilters, AdminConversationListItem, AdminCustomer, AdminDelivery, AdminLastMessage, AdminOpportunity, AdminOverview, AdminQueryService, AdminQuoteRequest, AdminScope, AdminVehicle } from "../../core/admin-read-model.js";
import { parseNextAction, toAverageMoney, toMoney } from "../../core/admin-read-model.js";
import type { CommercialEvent, Conversation, Message, Opportunity, OutboundDelivery, QuoteRequest } from "../../core/domain/entities.js";
import { Channel, CommercialEventType, CommercialOutcome, ConversationStatus, Intent, OpportunityStatus, OutboundDeliveryStatus, QuoteRequestStatus, SenderType } from "../../core/domain/enums.js";
import type { Money } from "../../core/domain/types.js";

type Row = Record<string, any>;
const value = (row: Row, key: string): any => row[key];
const text = (row: Row, key: string): string => String(row[key]);
const optionalText = (row: Row, key: string): string | undefined => row[key] == null ? undefined : String(row[key]);
function enumValue<T extends string>(values: readonly T[], raw: unknown): T { if (typeof raw === "string" && values.includes(raw as T)) return raw as T; throw new Error("Invalid administrative row"); }
function optionalEnum<T extends string>(values: readonly T[], raw: unknown): T | undefined { return raw == null ? undefined : enumValue(values, raw); }
function money(amount: unknown, currency: unknown): Money | undefined { return amount == null ? undefined : { amountCents: Number(amount), currency: currency === "BRL" ? "BRL" : "BRL" }; }
function postgresSql(sql: string): string { let index = 0; return sql.replace(/\?/g, () => `$${++index}`); }
function periodWhere(column: string, from: string | undefined, to: string | undefined, params: unknown[]): string {
  const clauses: string[] = [];
  if (from !== undefined) { clauses.push(`${column} >= ?`); params.push(from); }
  if (to !== undefined) { clauses.push(`${column} < ?`); params.push(to); }
  return clauses.length === 0 ? "TRUE" : clauses.join(" AND ");
}
function scopeConversationWhere(input: AdminConversationListFilters, params: unknown[]): string {
  const clauses = ["c.business_id = ?"];
  params.push(input.businessId);
  if (input.period?.from !== undefined) { clauses.push("c.started_at >= ?"); params.push(input.period.from); }
  if (input.period?.to !== undefined) { clauses.push("c.started_at < ?"); params.push(input.period.to); }
  if (input.channel !== undefined) { clauses.push("c.channel = ?"); params.push(input.channel); }
  if (input.status !== undefined) { clauses.push("c.status = ?"); params.push(input.status); }
  if (input.intent !== undefined) { clauses.push("c.current_intent = ?"); params.push(input.intent); }
  if (input.serviceItem !== undefined) { clauses.push("EXISTS (SELECT 1 FROM quote_requests fq WHERE fq.business_id = c.business_id AND fq.conversation_id = c.id AND fq.request_description ILIKE ?)"); params.push(`%${input.serviceItem}%`); }
  if (input.brand !== undefined) { clauses.push("EXISTS (SELECT 1 FROM vehicles fv WHERE fv.business_id = c.business_id AND fv.id = c.vehicle_id AND fv.brand ILIKE ?)"); params.push(`%${input.brand}%`); }
  if (input.model !== undefined) { clauses.push("EXISTS (SELECT 1 FROM vehicles fv WHERE fv.business_id = c.business_id AND fv.id = c.vehicle_id AND fv.model ILIKE ?)"); params.push(`%${input.model}%`); }
  if (input.year !== undefined) { clauses.push("EXISTS (SELECT 1 FROM vehicles fv WHERE fv.business_id = c.business_id AND fv.id = c.vehicle_id AND fv.year = ?)"); params.push(input.year); }
  return clauses.join(" AND ");
}

export class PostgresAmpliviewAdminReadModel implements AdminQueryService {
  constructor(private readonly database: PostgresDatabase) {}

  async getOverview(input: AdminScope): Promise<AdminOverview> {
    const conversationParams: unknown[] = [input.businessId];
    const conversationPeriod = periodWhere("started_at", input.period?.from, input.period?.to, conversationParams);
    if (input.channel !== undefined) conversationParams.push(input.channel);
    const conversations = await this.one(`SELECT COUNT(*) AS conversations, COUNT(DISTINCT customer_id) AS customers, COUNT(DISTINCT vehicle_id) AS vehicles FROM conversations WHERE business_id = ? AND ${conversationPeriod} ${input.channel === undefined ? "" : "AND channel = ?"}`, conversationParams);

    const quoteParams: unknown[] = [input.businessId];
    if (input.channel !== undefined) quoteParams.push(input.channel);
    const requestedPeriodParams: unknown[] = [];
    const requestedPeriod = periodWhere("q.requested_at", input.period?.from, input.period?.to, requestedPeriodParams);
    const respondedPeriodParams: unknown[] = [];
    const respondedPeriod = periodWhere("q.responded_at", input.period?.from, input.period?.to, respondedPeriodParams);
    const quotes = await this.one(`WITH scoped AS (SELECT q.* FROM quote_requests q JOIN conversations c ON c.business_id = q.business_id AND c.id = q.conversation_id WHERE q.business_id = ? ${input.channel === undefined ? "" : "AND c.channel = ?"})
      SELECT SUM(CASE WHEN ${requestedPeriod} THEN 1 ELSE 0 END) AS quote_requests,
      SUM(CASE WHEN q.responded_at IS NOT NULL AND ${respondedPeriod} THEN 1 ELSE 0 END) AS quote_responded,
      COALESCE(SUM(CASE WHEN q.responded_at IS NOT NULL AND ${respondedPeriod} THEN q.authorized_price_amount_cents ELSE 0 END), 0) AS authorized_total,
      AVG(CASE WHEN q.responded_at IS NOT NULL AND ${respondedPeriod} THEN q.authorized_price_amount_cents END) AS authorized_average,
      AVG(CASE WHEN q.responded_at IS NOT NULL AND ${respondedPeriod} THEN EXTRACT(EPOCH FROM (q.responded_at::timestamptz - q.requested_at::timestamptz)) * 1000.0 END) AS request_response_ms
      FROM scoped q`, [...quoteParams, ...requestedPeriodParams, ...respondedPeriodParams, ...respondedPeriodParams, ...respondedPeriodParams, ...respondedPeriodParams]);

    const publishedParams: unknown[] = [input.businessId, CommercialEventType.QUOTE_PUBLISHED];
    const publishedPeriodParams: unknown[] = [];
    const publishedPeriod = periodWhere("e.occurred_at", input.period?.from, input.period?.to, publishedPeriodParams);
    const published = await this.one(`SELECT COUNT(*) AS quote_published,
      AVG(CASE WHEN q.responded_at IS NOT NULL THEN EXTRACT(EPOCH FROM (e.occurred_at::timestamptz - q.responded_at::timestamptz)) * 1000.0 END) AS response_publish_ms
      FROM commercial_events e LEFT JOIN quote_requests q ON q.business_id = e.business_id AND q.id = e.quote_request_id
      JOIN conversations c ON c.business_id = e.business_id AND c.id = e.conversation_id
      WHERE e.business_id = ? AND e.event_type = ? AND ${publishedPeriod} ${input.channel === undefined ? "" : "AND c.channel = ?"}`,
      [...publishedParams, ...publishedPeriodParams, ...(input.channel === undefined ? [] : [input.channel])]);

    const deliveryParams: unknown[] = [OutboundDeliveryStatus.DELIVERED, OutboundDeliveryStatus.PENDING, OutboundDeliveryStatus.SENDING, OutboundDeliveryStatus.FAILED_RETRYABLE, OutboundDeliveryStatus.FAILED_FINAL, input.businessId];
    const deliveryPeriodParams: unknown[] = [];
    const deliveryPeriod = periodWhere("d.created_at", input.period?.from, input.period?.to, deliveryPeriodParams);
    deliveryParams.push(...deliveryPeriodParams);
    if (input.channel !== undefined) deliveryParams.push(input.channel);
    const deliveries = await this.one(`SELECT SUM(CASE WHEN d.status = ? THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN d.status IN (?, ?) THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN d.status IN (?, ?) THEN 1 ELSE 0 END) AS failed
      FROM outbound_deliveries d WHERE d.business_id = ? AND ${deliveryPeriod} ${input.channel === undefined ? "" : "AND d.channel = ?"}`, deliveryParams);

    const publishDeliveryParams: unknown[] = [input.businessId, CommercialEventType.QUOTE_PUBLISHED];
    const publishDeliveryPeriodParams: unknown[] = [];
    const publishDeliveryPeriod = periodWhere("e.occurred_at", input.period?.from, input.period?.to, publishDeliveryPeriodParams);
    const publishDelivery = await this.one(`SELECT AVG(CASE WHEN d.delivered_at IS NOT NULL THEN EXTRACT(EPOCH FROM (d.delivered_at::timestamptz - e.occurred_at::timestamptz)) * 1000.0 END) AS publish_delivery_ms
      FROM commercial_events e JOIN outbound_deliveries d ON d.business_id = e.business_id AND d.quote_request_id = e.quote_request_id AND (e.channel IS NULL OR d.channel = e.channel)
      JOIN conversations c ON c.business_id = e.business_id AND c.id = e.conversation_id
      WHERE e.business_id = ? AND e.event_type = ? AND ${publishDeliveryPeriod} ${input.channel === undefined ? "" : "AND c.channel = ?"}`,
      [...publishDeliveryParams, ...publishDeliveryPeriodParams, ...(input.channel === undefined ? [] : [input.channel])]);

    return {
      businessId: input.businessId, period: input.period ?? {}, ...(input.channel === undefined ? {} : { channel: input.channel }),
      conversations: Number(value(conversations, "conversations") ?? 0), customers: Number(value(conversations, "customers") ?? 0), vehicles: Number(value(conversations, "vehicles") ?? 0),
      quoteRequests: Number(value(quotes, "quote_requests") ?? 0), quoteResponded: Number(value(quotes, "quote_responded") ?? 0), quotePublished: Number(value(published, "quote_published") ?? 0),
      deliveriesDelivered: Number(value(deliveries, "delivered") ?? 0), deliveriesPending: Number(value(deliveries, "pending") ?? 0), deliveriesFailed: Number(value(deliveries, "failed") ?? 0),
      authorizedValueTotal: { amountCents: Number(value(quotes, "authorized_total") ?? 0), currency: "BRL" },
      authorizedTicketAverage: toAverageMoney(value(quotes, "authorized_average") == null ? null : Number(value(quotes, "authorized_average"))),
      averageRequestToResponseMs: value(quotes, "request_response_ms") == null ? null : Math.round(Number(value(quotes, "request_response_ms"))),
      averageResponseToPublishMs: value(published, "response_publish_ms") == null ? null : Math.round(Number(value(published, "response_publish_ms"))),
      averagePublishToDeliveryMs: value(publishDelivery, "publish_delivery_ms") == null ? null : Math.round(Number(value(publishDelivery, "publish_delivery_ms"))),
    };
  }

  async listConversations(input: AdminConversationListFilters): Promise<AdminConversationList> {
    const countParams: unknown[] = [];
    const where = scopeConversationWhere(input, countParams);
    const count = await this.one(`SELECT COUNT(*) AS total FROM conversations c WHERE ${where}`, countParams);
    const params: unknown[] = [];
    const dataWhere = scopeConversationWhere(input, params);
    const offset = (input.page - 1) * input.pageSize;
    const rows = await this.rows(`WITH ranked_quotes AS (
      SELECT q.*, ROW_NUMBER() OVER (PARTITION BY q.business_id, q.conversation_id ORDER BY q.requested_at DESC, q.id DESC) AS rn FROM quote_requests q WHERE q.business_id = ?
    ), ranked_messages AS (
      SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.business_id, m.conversation_id ORDER BY m.created_at DESC, m.id DESC) AS rn FROM messages m WHERE m.business_id = ?
    ), ranked_deliveries AS (
      SELECT d.*, ROW_NUMBER() OVER (PARTITION BY d.business_id, d.quote_request_id ORDER BY d.updated_at DESC, d.id DESC) AS rn FROM outbound_deliveries d WHERE d.business_id = ?
    )
    SELECT c.id AS conversation_id,c.started_at,c.last_message_at,c.channel,c.status AS conversation_status,c.current_intent,c.commercial_outcome,
      cu.id AS customer_id,cu.name AS customer_name,cu.primary_phone AS customer_phone,cu.email AS customer_email,
      v.id AS vehicle_id,v.brand AS vehicle_brand,v.model AS vehicle_model,v.year AS vehicle_year,v.version AS vehicle_version,v.license_plate AS vehicle_plate,v.mileage AS vehicle_mileage,
      o.id AS opportunity_id,o.status AS opportunity_status,o.request_description AS opportunity_description,o.next_action,
      q.id AS quote_id,q.status AS quote_status,q.request_description AS quote_description,q.symptom_description,q.requested_at,q.responded_at,q.authorized_price_amount_cents,q.authorized_price_currency,
      d.id AS delivery_id,d.status AS delivery_status,d.attempts AS delivery_attempts,d.last_error AS delivery_last_error,d.delivered_at,d.provider_message_id,
      m.sender_type AS last_sender_type,m.content AS last_content,m.created_at AS last_created_at
    FROM conversations c
    LEFT JOIN customers cu ON cu.business_id = c.business_id AND cu.id = c.customer_id
    LEFT JOIN vehicles v ON v.business_id = c.business_id AND v.id = c.vehicle_id
    LEFT JOIN ranked_quotes q ON q.business_id = c.business_id AND q.conversation_id = c.id AND q.rn = 1
    LEFT JOIN opportunities o ON o.business_id = q.business_id AND o.id = q.opportunity_id
    LEFT JOIN ranked_deliveries d ON d.business_id = q.business_id AND d.quote_request_id = q.id AND d.rn = 1
    LEFT JOIN ranked_messages m ON m.business_id = c.business_id AND m.conversation_id = c.id AND m.rn = 1
    WHERE ${dataWhere} ORDER BY c.last_message_at DESC,c.id DESC LIMIT ? OFFSET ?`, [input.businessId, input.businessId, input.businessId, ...params, input.pageSize, offset]);
    return { items: rows.map((row) => this.mapListItem(row)), page: input.page, pageSize: input.pageSize, total: Number(value(count, "total") ?? 0) };
  }

  async getConversation(input: { businessId: string; conversationId: string }): Promise<AdminConversationDetail | null> {
    const row = await this.oneOrNull("SELECT * FROM conversations WHERE business_id = ? AND id = ?", [input.businessId, input.conversationId]);
    if (!row) return null;
    const conversation = this.mapConversation(row);
    const customerRow = conversation.customerId === undefined ? null : await this.oneOrNull("SELECT * FROM customers WHERE business_id = ? AND id = ?", [input.businessId, conversation.customerId]);
    const vehicleRow = conversation.vehicleId === undefined ? null : await this.oneOrNull("SELECT * FROM vehicles WHERE business_id = ? AND id = ?", [input.businessId, conversation.vehicleId]);
    const [messages, opportunities, quoteRequests, commercialEvents, outboundDeliveries] = await Promise.all([
      this.rows("SELECT * FROM messages WHERE business_id = ? AND conversation_id = ? ORDER BY created_at ASC,id ASC", [input.businessId, input.conversationId]),
      this.rows("SELECT * FROM opportunities WHERE business_id = ? AND conversation_id = ? ORDER BY created_at ASC,id ASC", [input.businessId, input.conversationId]),
      this.rows("SELECT * FROM quote_requests WHERE business_id = ? AND conversation_id = ? ORDER BY requested_at ASC,id ASC", [input.businessId, input.conversationId]),
      this.rows("SELECT * FROM commercial_events WHERE business_id = ? AND conversation_id = ? ORDER BY occurred_at ASC,id ASC", [input.businessId, input.conversationId]),
      this.rows("SELECT * FROM outbound_deliveries WHERE business_id = ? AND conversation_id = ? ORDER BY created_at ASC,id ASC", [input.businessId, input.conversationId]),
    ]);
    return { conversation, ...(customerRow ? { customer: this.mapCustomer(customerRow) } : {}), ...(vehicleRow ? { vehicle: this.mapVehicle(vehicleRow) } : {}), messages: messages.map((item) => this.mapMessage(item)), opportunities: opportunities.map((item) => this.mapOpportunity(item)), quoteRequests: quoteRequests.map((item) => this.mapQuote(item)), commercialEvents: commercialEvents.map((item) => this.mapCommercialEvent(item)), outboundDeliveries: outboundDeliveries.map((item) => this.mapDelivery(item)) };
  }

  private async rows(sql: string, params: unknown[]): Promise<Row[]> { const result = await this.database.query<Row>(postgresSql(sql), params); return result.rows; }
  private async one(sql: string, params: unknown[]): Promise<Row> { const rows = await this.rows(sql, params); return rows[0] ?? {}; }
  private async oneOrNull(sql: string, params: unknown[]): Promise<Row | null> { const rows = await this.rows(sql, params); return rows[0] ?? null; }
  private mapListItem(row: Row): AdminConversationListItem {
    return { conversationId: text(row, "conversation_id"), startedAt: text(row, "started_at"), lastMessageAt: text(row, "last_message_at"), channel: enumValue(Object.values(Channel), value(row, "channel")), conversationStatus: enumValue(Object.values(ConversationStatus), value(row, "conversation_status")), ...this.optionalListRelations(row) };
  }
  private optionalListRelations(row: Row): Partial<AdminConversationListItem> {
    const result: Partial<AdminConversationListItem> = {};
    const currentIntent = optionalEnum(Object.values(Intent), value(row, "current_intent"));
    const commercialOutcome = optionalEnum(Object.values(CommercialOutcome), value(row, "commercial_outcome"));
    if (currentIntent !== undefined) result.currentIntent = currentIntent;
    if (commercialOutcome !== undefined) result.commercialOutcome = commercialOutcome;
    if (value(row, "customer_id") != null) result.customer = this.mapCustomerPrefix(row);
    if (value(row, "vehicle_id") != null) result.vehicle = this.mapVehiclePrefix(row);
    if (value(row, "opportunity_id") != null) { const requestDescription = optionalText(row, "opportunity_description"); const nextAction = parseNextAction(value(row, "next_action")); result.opportunity = { id: text(row, "opportunity_id"), status: enumValue(Object.values(OpportunityStatus), value(row, "opportunity_status")), ...(requestDescription === undefined ? {} : { description: requestDescription }), ...(nextAction === undefined ? {} : { nextAction }) }; }
    if (value(row, "quote_id") != null) { const symptomDescription = optionalText(row, "symptom_description"); const respondedAt = optionalText(row, "responded_at"); const authorizedPrice = toMoney(value(row, "authorized_price_amount_cents")); result.quoteRequest = { id: text(row, "quote_id"), status: enumValue(Object.values(QuoteRequestStatus), value(row, "quote_status")), requestDescription: text(row, "quote_description"), ...(symptomDescription === undefined ? {} : { symptomDescription }), requestedAt: text(row, "requested_at"), ...(respondedAt === undefined ? {} : { respondedAt }), ...(authorizedPrice === undefined ? {} : { authorizedPrice }) }; }
    if (value(row, "delivery_id") != null) { const lastError = optionalText(row, "delivery_last_error"); const deliveredAt = optionalText(row, "delivered_at"); const providerMessageId = optionalText(row, "provider_message_id"); result.delivery = { id: text(row, "delivery_id"), status: enumValue(Object.values(OutboundDeliveryStatus), value(row, "delivery_status")), attempts: Number(value(row, "delivery_attempts")), ...(lastError === undefined ? {} : { lastError }), ...(deliveredAt === undefined ? {} : { deliveredAt }), ...(providerMessageId === undefined ? {} : { providerMessageId }) }; }
    if (value(row, "last_sender_type") != null) result.lastMessage = { senderType: enumValue(Object.values(SenderType), value(row, "last_sender_type")), content: text(row, "last_content"), createdAt: text(row, "last_created_at") };
    return result;
  }
  private mapCustomerPrefix(row: Row): AdminCustomer { const name = optionalText(row, "customer_name"); const primaryPhone = optionalText(row, "customer_phone"); const email = optionalText(row, "customer_email"); return { id: text(row, "customer_id"), ...(name === undefined ? {} : { name }), ...(primaryPhone === undefined ? {} : { primaryPhone }), ...(email === undefined ? {} : { email }) }; }
  private mapVehiclePrefix(row: Row): AdminVehicle { const brand = optionalText(row, "vehicle_brand"); const model = optionalText(row, "vehicle_model"); const version = optionalText(row, "vehicle_version"); const licensePlate = optionalText(row, "vehicle_plate"); return { id: text(row, "vehicle_id"), ...(brand === undefined ? {} : { brand }), ...(model === undefined ? {} : { model }), ...(value(row, "vehicle_year") === null ? {} : { year: Number(value(row, "vehicle_year")) }), ...(version === undefined ? {} : { version }), ...(licensePlate === undefined ? {} : { licensePlate }), ...(value(row, "vehicle_mileage") === null ? {} : { mileage: Number(value(row, "vehicle_mileage")) }) }; }
  private mapCustomer(row: Row): AdminCustomer { const name = optionalText(row, "name"); const primaryPhone = optionalText(row, "primary_phone"); const email = optionalText(row, "email"); return { id: text(row, "id"), ...(name === undefined ? {} : { name }), ...(primaryPhone === undefined ? {} : { primaryPhone }), ...(email === undefined ? {} : { email }) }; }
  private mapVehicle(row: Row): AdminVehicle { const brand = optionalText(row, "brand"); const model = optionalText(row, "model"); const version = optionalText(row, "version"); const licensePlate = optionalText(row, "license_plate"); return { id: text(row, "id"), ...(brand === undefined ? {} : { brand }), ...(model === undefined ? {} : { model }), ...(version === undefined ? {} : { version }), ...(licensePlate === undefined ? {} : { licensePlate }), ...(value(row, "year") === null ? {} : { year: Number(value(row, "year")) }), ...(value(row, "mileage") === null ? {} : { mileage: Number(value(row, "mileage")) }) }; }
  private mapConversation(row: Row): Conversation { const customerId = optionalText(row, "customer_id"); const vehicleId = optionalText(row, "vehicle_id"); const commercialOutcome = optionalEnum(Object.values(CommercialOutcome), value(row, "commercial_outcome")); const currentIntent = optionalEnum(Object.values(Intent), value(row, "current_intent")); const closedAt = optionalText(row, "closed_at"); return { id: text(row, "id"), businessId: text(row, "business_id"), ...(customerId === undefined ? {} : { customerId }), ...(vehicleId === undefined ? {} : { vehicleId }), channel: enumValue(Object.values(Channel), value(row, "channel")), status: enumValue(Object.values(ConversationStatus), value(row, "status")), ...(commercialOutcome === undefined ? {} : { commercialOutcome }), ...(currentIntent === undefined ? {} : { currentIntent }), startedAt: text(row, "started_at"), lastMessageAt: text(row, "last_message_at"), ...(closedAt === undefined ? {} : { closedAt }) }; }
  private mapMessage(row: Row): Message { const externalMessageId = optionalText(row, "external_message_id"); return { id: text(row, "id"), businessId: text(row, "business_id"), conversationId: text(row, "conversation_id"), senderType: enumValue(Object.values(SenderType), value(row, "sender_type")), channel: enumValue(Object.values(Channel), value(row, "channel")), content: text(row, "content"), ...(externalMessageId === undefined ? {} : { externalMessageId }), createdAt: text(row, "created_at") }; }
  private mapOpportunity(row: Row): Opportunity { const customerId = optionalText(row, "customer_id"); const vehicleId = optionalText(row, "vehicle_id"); const requestDescription = optionalText(row, "request_description"); const nextAction = parseNextAction(value(row, "next_action")); const estimatedValue = money(value(row, "estimated_value_amount_cents"), value(row, "estimated_value_currency")); const realizedValue = money(value(row, "realized_value_amount_cents"), value(row, "realized_value_currency")); const valueSource = optionalText(row, "value_source"); const closedAt = optionalText(row, "closed_at"); return { id: text(row, "id"), businessId: text(row, "business_id"), conversationId: text(row, "conversation_id"), ...(customerId === undefined ? {} : { customerId }), ...(vehicleId === undefined ? {} : { vehicleId }), ...(requestDescription === undefined ? {} : { requestDescription }), status: enumValue(Object.values(OpportunityStatus), value(row, "status")), ...(nextAction === undefined ? {} : { nextAction }), ...(estimatedValue === undefined ? {} : { estimatedValue }), ...(realizedValue === undefined ? {} : { realizedValue }), ...(valueSource === undefined ? {} : { valueSource }), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"), ...(closedAt === undefined ? {} : { closedAt }) }; }
  private mapQuote(row: Row): QuoteRequest { const customerId = optionalText(row, "customer_id"); const vehicleId = optionalText(row, "vehicle_id"); const symptomDescription = optionalText(row, "symptom_description"); const respondedAt = optionalText(row, "responded_at"); const authorizedPrice = money(value(row, "authorized_price_amount_cents"), value(row, "authorized_price_currency")); return { id: text(row, "id"), businessId: text(row, "business_id"), opportunityId: text(row, "opportunity_id"), conversationId: text(row, "conversation_id"), ...(customerId === undefined ? {} : { customerId }), ...(vehicleId === undefined ? {} : { vehicleId }), requestDescription: text(row, "request_description"), ...(symptomDescription === undefined ? {} : { symptomDescription }), status: enumValue(Object.values(QuoteRequestStatus), value(row, "status")), requestedAt: text(row, "requested_at"), ...(respondedAt === undefined ? {} : { respondedAt }), ...(authorizedPrice === undefined ? {} : { authorizedPrice }), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at") }; }
  private mapCommercialEvent(row: Row): CommercialEvent { const conversationId = optionalText(row, "conversation_id"); const customerId = optionalText(row, "customer_id"); const vehicleId = optionalText(row, "vehicle_id"); const opportunityId = optionalText(row, "opportunity_id"); const quoteRequestId = optionalText(row, "quote_request_id"); const channel = optionalEnum(Object.values(Channel), value(row, "channel")); const intent = optionalEnum(Object.values(Intent), value(row, "intent")); const commercialOutcome = optionalEnum(Object.values(CommercialOutcome), value(row, "commercial_outcome")); const requestedItem = optionalText(row, "requested_item"); const symptom = optionalText(row, "symptom"); const vehicleBrand = optionalText(row, "vehicle_brand"); const vehicleModel = optionalText(row, "vehicle_model"); const amount = money(value(row, "amount_cents"), value(row, "currency")); return { id: text(row, "id"), businessId: text(row, "business_id"), eventType: enumValue(Object.values(CommercialEventType), value(row, "event_type")), ...(conversationId === undefined ? {} : { conversationId }), ...(customerId === undefined ? {} : { customerId }), ...(vehicleId === undefined ? {} : { vehicleId }), ...(opportunityId === undefined ? {} : { opportunityId }), ...(quoteRequestId === undefined ? {} : { quoteRequestId }), ...(channel === undefined ? {} : { channel }), ...(intent === undefined ? {} : { intent }), ...(commercialOutcome === undefined ? {} : { commercialOutcome }), ...(requestedItem === undefined ? {} : { requestedItem }), ...(symptom === undefined ? {} : { symptom }), ...(vehicleBrand === undefined ? {} : { vehicleBrand }), ...(vehicleModel === undefined ? {} : { vehicleModel }), ...(value(row, "vehicle_year") === null ? {} : { vehicleYear: Number(value(row, "vehicle_year")) }), ...(amount === undefined ? {} : { amount }), occurredAt: text(row, "occurred_at") }; }
  private mapDelivery(row: Row): OutboundDelivery { const messageId = optionalText(row, "message_id"); const recipientRef = optionalText(row, "recipient_ref"); const lastError = optionalText(row, "last_error"); const providerMessageId = optionalText(row, "provider_message_id"); const nextAttemptAt = optionalText(row, "next_attempt_at"); const deliveredAt = optionalText(row, "delivered_at"); const claimedAt = optionalText(row, "claimed_at"); const leaseUntil = optionalText(row, "lease_until"); const claimToken = optionalText(row, "claim_token"); return { id: text(row, "id"), businessId: text(row, "business_id"), ...(messageId === undefined ? {} : { messageId }), quoteRequestId: text(row, "quote_request_id"), conversationId: text(row, "conversation_id"), channel: enumValue(Object.values(Channel), value(row, "channel")), ...(recipientRef === undefined ? {} : { recipientRef }), status: enumValue(Object.values(OutboundDeliveryStatus), value(row, "status")), attempts: Number(value(row, "attempts")), ...(lastError === undefined ? {} : { lastError }), ...(providerMessageId === undefined ? {} : { providerMessageId }), ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"), ...(deliveredAt === undefined ? {} : { deliveredAt }), ...(claimedAt === undefined ? {} : { claimedAt }), ...(leaseUntil === undefined ? {} : { leaseUntil }), ...(claimToken === undefined ? {} : { claimToken }) }; }
}
