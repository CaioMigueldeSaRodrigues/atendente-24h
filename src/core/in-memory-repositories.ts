import type {
  Appointment,
  AutomotiveBusiness,
  CatalogItem,
  Conversation,
  Customer,
  HumanHandoff,
  Message,
  Opportunity,
  QuoteRequest,
  Vehicle,
} from "./domain/entities.js";
import type {
  AppointmentRepository,
  AutomotiveBusinessRepository,
  CatalogItemRepository,
  ConversationRepository,
  CustomerRepository,
  HumanHandoffRepository,
  MessageRepository,
  OpportunityRepository,
  QuoteRequestRepository,
  VehicleRepository,
} from "./repositories.js";

export class InMemoryAutomotiveBusinessRepository
  implements AutomotiveBusinessRepository
{
  private readonly businesses = new Map<string, AutomotiveBusiness>();

  async findById(id: string): Promise<AutomotiveBusiness | null> {
    return this.businesses.get(id) ?? null;
  }

  async save(entity: AutomotiveBusiness): Promise<void> {
    this.businesses.set(entity.id, entity);
  }
}

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly customers = new Map<string, Map<string, Customer>>();

  async findById(businessId: string, id: string): Promise<Customer | null> {
    return this.customers.get(businessId)?.get(id) ?? null;
  }

  async save(entity: Customer): Promise<void> {
    let businessCustomers = this.customers.get(entity.businessId);
    if (!businessCustomers) {
      businessCustomers = new Map<string, Customer>();
      this.customers.set(entity.businessId, businessCustomers);
    }
    businessCustomers.set(entity.id, entity);
  }
}

export class InMemoryVehicleRepository implements VehicleRepository {
  private readonly vehicles = new Map<string, Map<string, Vehicle>>();

  async findById(businessId: string, id: string): Promise<Vehicle | null> {
    return this.vehicles.get(businessId)?.get(id) ?? null;
  }

  async save(entity: Vehicle): Promise<void> {
    let businessVehicles = this.vehicles.get(entity.businessId);
    if (!businessVehicles) {
      businessVehicles = new Map<string, Vehicle>();
      this.vehicles.set(entity.businessId, businessVehicles);
    }
    businessVehicles.set(entity.id, entity);
  }
}

export class InMemoryCatalogItemRepository implements CatalogItemRepository {
  private readonly catalogItems = new Map<string, Map<string, CatalogItem>>();

  async findById(businessId: string, id: string): Promise<CatalogItem | null> {
    return this.catalogItems.get(businessId)?.get(id) ?? null;
  }

  async save(entity: CatalogItem): Promise<void> {
    let businessItems = this.catalogItems.get(entity.businessId);
    if (!businessItems) {
      businessItems = new Map<string, CatalogItem>();
      this.catalogItems.set(entity.businessId, businessItems);
    }
    businessItems.set(entity.id, entity);
  }
}

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<string, Map<string, Conversation>>();

  async findById(businessId: string, id: string): Promise<Conversation | null> {
    return this.conversations.get(businessId)?.get(id) ?? null;
  }

  async save(entity: Conversation): Promise<void> {
    let businessConversations = this.conversations.get(entity.businessId);
    if (!businessConversations) {
      businessConversations = new Map<string, Conversation>();
      this.conversations.set(entity.businessId, businessConversations);
    }
    businessConversations.set(entity.id, entity);
  }
}

export class InMemoryMessageRepository implements MessageRepository {
  private readonly messages = new Map<string, Message[]>();

  async save(entity: Message): Promise<void> {
    let businessMessages = this.messages.get(entity.businessId);
    if (!businessMessages) {
      businessMessages = [];
      this.messages.set(entity.businessId, businessMessages);
    }

    const existingIndex = businessMessages.findIndex(
      (message) => message.id === entity.id,
    );
    if (existingIndex === -1) {
      businessMessages.push(entity);
    } else {
      businessMessages[existingIndex] = entity;
    }
  }

  async listByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<Message[]> {
    return (this.messages.get(businessId) ?? []).filter(
      (message) => message.businessId === businessId && message.conversationId === conversationId,
    );
  }
}

export class InMemoryOpportunityRepository implements OpportunityRepository {
  private readonly opportunities = new Map<string, Map<string, Opportunity>>();

  async findById(businessId: string, id: string): Promise<Opportunity | null> {
    return this.opportunities.get(businessId)?.get(id) ?? null;
  }

  async save(entity: Opportunity): Promise<void> {
    let businessOpportunities = this.opportunities.get(entity.businessId);
    if (!businessOpportunities) {
      businessOpportunities = new Map<string, Opportunity>();
      this.opportunities.set(entity.businessId, businessOpportunities);
    }
    businessOpportunities.set(entity.id, entity);
  }
}

export class InMemoryQuoteRequestRepository implements QuoteRequestRepository {
  private readonly quoteRequests = new Map<string, Map<string, QuoteRequest>>();

  async findById(businessId: string, id: string): Promise<QuoteRequest | null> {
    return this.quoteRequests.get(businessId)?.get(id) ?? null;
  }

  async save(entity: QuoteRequest): Promise<void> {
    let businessQuoteRequests = this.quoteRequests.get(entity.businessId);
    if (!businessQuoteRequests) {
      businessQuoteRequests = new Map<string, QuoteRequest>();
      this.quoteRequests.set(entity.businessId, businessQuoteRequests);
    }
    businessQuoteRequests.set(entity.id, entity);
  }
}

export class InMemoryAppointmentRepository implements AppointmentRepository {
  private readonly appointments = new Map<string, Map<string, Appointment>>();

  async findById(businessId: string, id: string): Promise<Appointment | null> {
    return this.appointments.get(businessId)?.get(id) ?? null;
  }

  async save(entity: Appointment): Promise<void> {
    let businessAppointments = this.appointments.get(entity.businessId);
    if (!businessAppointments) {
      businessAppointments = new Map<string, Appointment>();
      this.appointments.set(entity.businessId, businessAppointments);
    }
    businessAppointments.set(entity.id, entity);
  }
}

export class InMemoryHumanHandoffRepository implements HumanHandoffRepository {
  private readonly handoffs = new Map<string, Map<string, HumanHandoff>>();

  async findById(businessId: string, id: string): Promise<HumanHandoff | null> {
    return this.handoffs.get(businessId)?.get(id) ?? null;
  }

  async save(entity: HumanHandoff): Promise<void> {
    let businessHandoffs = this.handoffs.get(entity.businessId);
    if (!businessHandoffs) {
      businessHandoffs = new Map<string, HumanHandoff>();
      this.handoffs.set(entity.businessId, businessHandoffs);
    }
    businessHandoffs.set(entity.id, entity);
  }
}
