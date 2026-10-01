import type {
  CommercialEvent,
  Conversation,
  Customer,
  Message,
  Opportunity,
  OutboundDelivery,
  QuoteRequest,
  Vehicle,
} from "./domain/entities.js";
import type { Channel, ConversationStatus, Intent } from "./domain/enums.js";
import type { Money, NextAction } from "./domain/types.js";

/** `from` is inclusive and `to` is exclusive. */
export type AdminPeriod = { from?: string; to?: string };
export type AdminScope = { businessId: string; period?: AdminPeriod; channel?: Channel };

export type AdminOverview = {
  businessId: string;
  period: AdminPeriod;
  channel?: Channel;
  conversations: number;
  customers: number;
  vehicles: number;
  quoteRequests: number;
  quoteResponded: number;
  quotePublished: number;
  deliveriesDelivered: number;
  deliveriesPending: number;
  deliveriesFailed: number;
  authorizedValueTotal: Money;
  authorizedTicketAverage: Money | null;
  averageRequestToResponseMs: number | null;
  averageResponseToPublishMs: number | null;
  averagePublishToDeliveryMs: number | null;
};

export type AdminConversationListFilters = AdminScope & {
  status?: ConversationStatus;
  intent?: Intent;
  serviceItem?: string;
  brand?: string;
  model?: string;
  year?: number;
  page: number;
  pageSize: number;
};

export type AdminCustomer = Pick<Customer, "id" | "name" | "primaryPhone" | "email">;
export type AdminVehicle = Pick<Vehicle, "id" | "brand" | "model" | "year" | "version" | "licensePlate" | "mileage">;
export type AdminOpportunity = { id: Opportunity["id"]; status: Opportunity["status"]; description?: string; nextAction?: NextAction };
export type AdminQuoteRequest = Pick<QuoteRequest, "id" | "status" | "requestDescription" | "symptomDescription" | "requestedAt" | "respondedAt" | "authorizedPrice">;
export type AdminDelivery = Pick<OutboundDelivery, "id" | "status" | "attempts" | "lastError" | "deliveredAt" | "providerMessageId">;
export type AdminLastMessage = Pick<Message, "senderType" | "content" | "createdAt">;

export type AdminConversationListItem = {
  conversationId: string;
  startedAt: string;
  lastMessageAt: string;
  channel: Channel;
  conversationStatus: ConversationStatus;
  currentIntent?: Intent;
  commercialOutcome?: Conversation["commercialOutcome"];
  customer?: AdminCustomer;
  vehicle?: AdminVehicle;
  opportunity?: AdminOpportunity;
  quoteRequest?: AdminQuoteRequest;
  delivery?: AdminDelivery;
  lastMessage?: AdminLastMessage;
};

export type AdminConversationList = {
  items: AdminConversationListItem[];
  page: number;
  pageSize: number;
  total: number;
};

export type AdminConversationDetail = {
  conversation: Conversation;
  customer?: AdminCustomer;
  vehicle?: AdminVehicle;
  messages: Message[];
  opportunities: Opportunity[];
  quoteRequests: QuoteRequest[];
  commercialEvents: CommercialEvent[];
  outboundDeliveries: OutboundDelivery[];
};

export type AdminQueryService = {
  getOverview(input: AdminScope & { period?: AdminPeriod }): Promise<AdminOverview>;
  listConversations(input: AdminConversationListFilters): Promise<AdminConversationList>;
  getConversation(input: { businessId: string; conversationId: string }): Promise<AdminConversationDetail | null>;
};

export type AdminBusinessScopeAuthorizer = {
  isAuthorized(input: { businessId: string }): Promise<boolean>;
};

export function parseAdminPeriod(from: string | undefined, to: string | undefined): AdminPeriod {
  if (from !== undefined && !isIsoTimestamp(from)) throw new Error("Invalid from");
  if (to !== undefined && !isIsoTimestamp(to)) throw new Error("Invalid to");
  if (from !== undefined && to !== undefined && Date.parse(from) >= Date.parse(to)) throw new Error("Invalid period");
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
}

export function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.includes("T");
}

export function parseAdminPagination(pageValue: string | undefined, pageSizeValue: string | undefined): { page: number; pageSize: number } {
  const page = pageValue === undefined ? 1 : Number(pageValue);
  const pageSize = pageSizeValue === undefined ? 25 : Number(pageSizeValue);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Invalid pagination");
  return { page, pageSize };
}

export function toMoney(amountCents: number | null | undefined): Money | undefined {
  return amountCents === null || amountCents === undefined ? undefined : { amountCents, currency: "BRL" };
}

export function toAverageMoney(amountCents: number | null | undefined): Money | null {
  return amountCents === null || amountCents === undefined ? null : { amountCents: Math.round(amountCents), currency: "BRL" };
}

export function parseNextAction(value: unknown): NextAction | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as { type?: unknown }).type !== "string" || typeof (parsed as { description?: unknown }).description !== "string") return undefined;
  return parsed as NextAction;
}
