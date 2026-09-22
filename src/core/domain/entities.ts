import type {
  BusinessType,
  CatalogItemKind,
  Channel,
  CommercialOutcome,
  ConversationStatus,
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
