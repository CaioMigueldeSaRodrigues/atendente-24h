import type {
  BusinessType,
  CatalogItemKind,
  Channel,
  CommercialEventType,
  CommercialOutcome,
  AssistantHealthEventType,
  ConversationStatus,
  AppointmentStatus,
  HandoffReason,
  HandoffStatus,
  Intent,
  OpportunityStatus,
  QuoteRequestStatus,
  SenderType,
} from "./enums.js";
import type { Money, NextAction } from "./types.js";

export type AutomotiveBusiness = {
  id: string;
  name: string;
  legalName?: string;
  businessType: BusinessType;
  phone?: string;
  email?: string;
  address?: string;
  timezone: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Customer = {
  id: string;
  businessId: string;
  name?: string;
  primaryPhone?: string;
  email?: string;
  preferredContactChannel?: Channel;
  createdAt: string;
  updatedAt: string;
};

export type Vehicle = {
  id: string;
  businessId: string;
  customerId?: string;
  brand?: string;
  model?: string;
  year?: number;
  version?: string;
  licensePlate?: string;
  mileage?: number;
  createdAt: string;
  updatedAt: string;
};

export type CatalogItem = {
  id: string;
  businessId: string;
  kind: CatalogItemKind;
  name: string;
  description?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  businessId: string;
  customerId?: string;
  vehicleId?: string;
  channel: Channel;
  status: ConversationStatus;
  commercialOutcome?: CommercialOutcome;
  currentIntent?: Intent;
  startedAt: string;
  lastMessageAt: string;
  closedAt?: string;
};

export type Message = {
  id: string;
  businessId: string;
  conversationId: string;
  senderType: SenderType;
  channel: Channel;
  content: string;
  externalMessageId?: string;
  createdAt: string;
};

export type Opportunity = {
  id: string;
  businessId: string;
  conversationId: string;
  customerId?: string;
  vehicleId?: string;
  requestDescription?: string;
  status: OpportunityStatus;
  nextAction?: NextAction;
  estimatedValue?: Money;
  realizedValue?: Money;
  valueSource?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};

export type QuoteRequest = {
  id: string;
  businessId: string;
  opportunityId: string;
  conversationId: string;
  customerId?: string;
  vehicleId?: string;
  requestDescription: string;
  symptomDescription?: string;
  status: QuoteRequestStatus;
  requestedAt: string;
  respondedAt?: string;
  authorizedPrice?: Money;
  createdAt: string;
  updatedAt: string;
};

export type Appointment = {
  id: string;
  businessId: string;
  opportunityId?: string;
  conversationId: string;
  customerId?: string;
  vehicleId?: string;
  requestedDate?: string;
  requestedTime?: string;
  confirmedStartAt?: string;
  status: AppointmentStatus;
  requestDescription?: string;
  externalAppointmentId?: string;
  createdAt: string;
  updatedAt: string;
};

export type HumanHandoff = {
  id: string;
  businessId: string;
  conversationId: string;
  opportunityId?: string;
  reason: HandoffReason;
  summary: string;
  status: HandoffStatus;
  assignedTo?: string;
  requestedAt: string;
  acceptedAt?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CommercialEvent = {
  id: string;
  businessId: string;
  eventType: CommercialEventType;
  conversationId?: string;
  customerId?: string;
  vehicleId?: string;
  opportunityId?: string;
  quoteRequestId?: string;
  channel?: Channel;
  intent?: Intent;
  commercialOutcome?: CommercialOutcome;
  businessType?: BusinessType;
  country?: string;
  state?: string;
  city?: string;
  region?: string;
  category?: string;
  requestedItem?: string;
  symptom?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  amount?: Money;
  occurredAt: string;
};

export type AssistantHealthEvent = {
  id: string;
  businessId: string;
  eventType: AssistantHealthEventType;
  conversationId?: string;
  opportunityId?: string;
  quoteRequestId?: string;
  channel?: Channel;
  businessType?: BusinessType;
  country?: string;
  state?: string;
  city?: string;
  region?: string;
  provider?: string;
  model?: string;
  reason?: string;
  occurredAt: string;
};
