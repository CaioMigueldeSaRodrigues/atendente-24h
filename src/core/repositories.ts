import type {
  Appointment,
  AssistantHealthEvent,
  AutomotiveBusiness,
  CatalogItem,
  Conversation,
  CommercialEvent,
  Customer,
  HumanHandoff,
  Message,
  Opportunity,
  QuoteRequest,
  Vehicle,
} from "./domain/entities.js";

export interface CommercialEventRepository {
  append(event: CommercialEvent): Promise<void>;
  listByBusiness(businessId: string): Promise<CommercialEvent[]>;
  listByConversation(businessId: string, conversationId: string): Promise<CommercialEvent[]>;
}

export interface AssistantHealthEventRepository {
  append(event: AssistantHealthEvent): Promise<void>;
  listByBusiness(businessId: string): Promise<AssistantHealthEvent[]>;
  listByConversation(businessId: string, conversationId: string): Promise<AssistantHealthEvent[]>;
}

export interface AutomotiveBusinessRepository {
  findById(id: string): Promise<AutomotiveBusiness | null>;
  save(entity: AutomotiveBusiness): Promise<void>;
}

export interface CustomerRepository {
  findById(businessId: string, id: string): Promise<Customer | null>;
  save(entity: Customer): Promise<void>;
}

export interface VehicleRepository {
  findById(businessId: string, id: string): Promise<Vehicle | null>;
  save(entity: Vehicle): Promise<void>;
}

export interface CatalogItemRepository {
  findById(businessId: string, id: string): Promise<CatalogItem | null>;
  save(entity: CatalogItem): Promise<void>;
}

export interface ConversationRepository {
  findById(businessId: string, id: string): Promise<Conversation | null>;
  save(entity: Conversation): Promise<void>;
}

export interface MessageRepository {
  save(entity: Message): Promise<void>;
  listByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<Message[]>;
}

export interface OpportunityRepository {
  findById(businessId: string, id: string): Promise<Opportunity | null>;
  listByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<Opportunity[]>;
  save(entity: Opportunity): Promise<void>;
}

export interface QuoteRequestRepository {
  findById(businessId: string, id: string): Promise<QuoteRequest | null>;
  listByBusiness(businessId: string): Promise<QuoteRequest[]>;
  listByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<QuoteRequest[]>;
  save(entity: QuoteRequest): Promise<void>;
}

export interface AppointmentRepository {
  findById(businessId: string, id: string): Promise<Appointment | null>;
  save(entity: Appointment): Promise<void>;
}

export interface HumanHandoffRepository {
  findById(businessId: string, id: string): Promise<HumanHandoff | null>;
  save(entity: HumanHandoff): Promise<void>;
}
