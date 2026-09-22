import type {
  BusinessType,
  CatalogItemKind,
  Channel,
  CommercialOutcome,
  ConversationStatus,
  Intent,
  SenderType,
} from "./enums.js";

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
