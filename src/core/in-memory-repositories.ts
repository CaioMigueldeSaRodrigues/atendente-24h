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
  OutboundDelivery,
  QuoteRequest,
  Vehicle,
} from "./domain/entities.js";
import type { QuoteDraft } from "./quote-draft.js";
import { QuoteDraftStatus } from "./quote-draft.js";
import { assertDraftSave } from "./quote-draft-write-policy.js";
import { QuoteDraftError } from "./build-quote-draft.js";
import type { BusinessAssistantIntegrationSettings, BusinessAssistantIntegrationSettingsRepository } from "./business-assistant-integration-settings.js";
import {
  OutboundDeliveryStatus,
} from "./domain/enums.js";
import type {
  AppointmentRepository,
  AssistantHealthEventRepository,
  AutomotiveBusinessRepository,
  CatalogItemRepository,
  ConversationRepository,
  CommercialEventRepository,
  CustomerRepository,
  HumanHandoffRepository,
  MessageRepository,
  OutboundDeliveryClaimResult,
  OutboundDeliveryFailure,
  OutboundDeliveryReservation,
  OutboundDeliveryRepository,
  OpportunityRepository,
  QuoteRequestRepository,
  VehicleRepository,
  QuoteDraftRepository,
} from "./repositories.js";

function compareEventOrder(left: { occurredAt: string; id: string }, right: { occurredAt: string; id: string }): number {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function cloneCommercialEvent(event: CommercialEvent): CommercialEvent {
  return { ...event, ...(event.amount ? { amount: { ...event.amount } } : {}) };
}

function cloneAssistantHealthEvent(event: AssistantHealthEvent): AssistantHealthEvent {
  return { ...event };
}

export class InMemoryCommercialEventRepository implements CommercialEventRepository {
  private readonly events = new Map<string, Map<string, CommercialEvent>>();

  async append(event: CommercialEvent): Promise<void> {
    if (event.amount !== undefined &&
      (!Number.isSafeInteger(event.amount.amountCents) || event.amount.amountCents < 0 || event.amount.currency !== "BRL")) {
      throw new Error("Failed to append CommercialEvent");
    }
    let businessEvents = this.events.get(event.businessId);
    if (!businessEvents) {
      businessEvents = new Map<string, CommercialEvent>();
      this.events.set(event.businessId, businessEvents);
    }
    if (businessEvents.has(event.id)) throw new Error("Failed to append CommercialEvent");
    businessEvents.set(event.id, cloneCommercialEvent(event));
  }

  async listByBusiness(businessId: string): Promise<CommercialEvent[]> {
    return [...(this.events.get(businessId)?.values() ?? [])]
      .sort(compareEventOrder).map(cloneCommercialEvent);
  }

  async listByConversation(businessId: string, conversationId: string): Promise<CommercialEvent[]> {
    return [...(this.events.get(businessId)?.values() ?? [])]
      .filter((event) => event.businessId === businessId && event.conversationId === conversationId)
      .sort(compareEventOrder).map(cloneCommercialEvent);
  }
}

export class InMemoryAssistantHealthEventRepository implements AssistantHealthEventRepository {
  private readonly events = new Map<string, Map<string, AssistantHealthEvent>>();

  async append(event: AssistantHealthEvent): Promise<void> {
    let businessEvents = this.events.get(event.businessId);
    if (!businessEvents) {
      businessEvents = new Map<string, AssistantHealthEvent>();
      this.events.set(event.businessId, businessEvents);
    }
    if (businessEvents.has(event.id)) throw new Error("Failed to append AssistantHealthEvent");
    businessEvents.set(event.id, cloneAssistantHealthEvent(event));
  }

  async listByBusiness(businessId: string): Promise<AssistantHealthEvent[]> {
    return [...(this.events.get(businessId)?.values() ?? [])]
      .sort(compareEventOrder).map(cloneAssistantHealthEvent);
  }

  async listByConversation(businessId: string, conversationId: string): Promise<AssistantHealthEvent[]> {
    return [...(this.events.get(businessId)?.values() ?? [])]
      .filter((event) => event.businessId === businessId && event.conversationId === conversationId)
      .sort(compareEventOrder).map(cloneAssistantHealthEvent);
  }
}

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

  async listByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<Opportunity[]> {
    const businessOpportunities = this.opportunities.get(businessId);
    return [...(businessOpportunities?.values() ?? [])].filter(
      (opportunity) => opportunity.businessId === businessId &&
        opportunity.conversationId === conversationId,
    );
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

  async listByBusiness(businessId: string): Promise<QuoteRequest[]> {
    return [...(this.quoteRequests.get(businessId)?.values() ?? [])]
      .filter((quoteRequest) => quoteRequest.businessId === businessId)
      .sort((left, right) => {
        if (left.requestedAt !== right.requestedAt) {
          return left.requestedAt < right.requestedAt ? -1 : 1;
        }
        if (left.id === right.id) return 0;
        return left.id < right.id ? -1 : 1;
      });
  }

  async listByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<QuoteRequest[]> {
    const businessQuoteRequests = this.quoteRequests.get(businessId);
    return [...(businessQuoteRequests?.values() ?? [])].filter(
      (quoteRequest) => quoteRequest.businessId === businessId &&
        quoteRequest.conversationId === conversationId,
    );
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

export class InMemoryOutboundDeliveryRepository implements OutboundDeliveryRepository {
  private readonly deliveries = new Map<string, Map<string, OutboundDelivery>>();

  async findById(businessId: string, id: string): Promise<OutboundDelivery | null> {
    return this.deliveries.get(businessId)?.get(id) ?? null;
  }

  async findByMessageAndChannel(
    businessId: string,
    messageId: string,
    channel: OutboundDelivery["channel"],
  ): Promise<OutboundDelivery | null> {
    return [...(this.deliveries.get(businessId)?.values() ?? [])]
      .find((delivery) => delivery.messageId === messageId && delivery.channel === channel) ?? null;
  }

  async findByQuoteRequestAndChannel(
    businessId: string,
    quoteRequestId: string,
    channel: OutboundDelivery["channel"],
  ): Promise<OutboundDelivery | null> {
    return [...(this.deliveries.get(businessId)?.values() ?? [])]
      .find((delivery) => delivery.quoteRequestId === quoteRequestId && delivery.channel === channel) ?? null;
  }

  async create(entity: OutboundDelivery): Promise<OutboundDelivery> {
    return (await this.reserve(entity)).delivery;
  }

  async reserve(entity: OutboundDelivery): Promise<OutboundDeliveryReservation> {
    let businessDeliveries = this.deliveries.get(entity.businessId);
    if (!businessDeliveries) {
      businessDeliveries = new Map<string, OutboundDelivery>();
      this.deliveries.set(entity.businessId, businessDeliveries);
    }
    const existing = [...businessDeliveries.values()]
      .find((delivery) => delivery.quoteRequestId === entity.quoteRequestId && delivery.channel === entity.channel);
    if (existing) return { created: false, delivery: existing };
    businessDeliveries.set(entity.id, entity);
    return { created: true, delivery: entity };
  }

  async attachMessage(businessId: string, id: string, messageId: string, updatedAt: string): Promise<OutboundDelivery> {
    const delivery = await this.require(businessId, id);
    if (delivery.messageId !== undefined && delivery.messageId !== messageId) {
      throw new Error("OutboundDelivery message is already attached");
    }
    const updated = { ...delivery, messageId, updatedAt };
    this.deliveries.get(businessId)!.set(id, updated);
    return updated;
  }

  async claimForSending(
    businessId: string,
    id: string,
    now: string,
    leaseUntil: string,
    claimToken: string,
  ): Promise<OutboundDeliveryClaimResult> {
    const delivery = await this.findById(businessId, id);
    if (!delivery) throw new Error("OutboundDelivery not found");
    if (delivery.status === OutboundDeliveryStatus.PENDING ||
      (delivery.status === OutboundDeliveryStatus.FAILED_RETRYABLE &&
        (delivery.nextAttemptAt === undefined || delivery.nextAttemptAt <= now)) ||
      (delivery.status === OutboundDeliveryStatus.SENDING &&
        delivery.leaseUntil !== undefined && delivery.leaseUntil <= now)) {
      const claimed: OutboundDelivery = {
        ...delivery,
        status: OutboundDeliveryStatus.SENDING,
        attempts: delivery.attempts + 1,
        updatedAt: now,
        claimedAt: now,
        leaseUntil,
        claimToken,
      };
      this.deliveries.get(businessId)!.set(id, claimed);
      return { claimed: true, delivery: claimed };
    }
    return { claimed: false, delivery };
  }

  async markDelivered(
    businessId: string,
    id: string,
    deliveredAt: string,
    updatedAt: string,
    claimToken: string,
    providerMessageId?: string,
  ): Promise<OutboundDelivery> {
    const delivery = await this.require(businessId, id);
    if (delivery.status !== OutboundDeliveryStatus.SENDING || delivery.claimToken !== claimToken) throw new Error("OutboundDelivery is not sending");
    const { lastError: _lastError, nextAttemptAt: _nextAttemptAt, claimedAt: _claimedAt, leaseUntil: _leaseUntil, claimToken: _claimToken, ...withoutFailure } = delivery;
    const updated: OutboundDelivery = {
      ...withoutFailure,
      status: OutboundDeliveryStatus.DELIVERED,
      deliveredAt,
      updatedAt,
      ...(providerMessageId === undefined ? {} : { providerMessageId }),
    };
    this.deliveries.get(businessId)!.set(id, updated);
    return updated;
  }

  async markFailed(
    businessId: string,
    id: string,
    failure: OutboundDeliveryFailure,
    claimToken: string,
  ): Promise<OutboundDelivery> {
    const delivery = await this.require(businessId, id);
    if (delivery.status !== OutboundDeliveryStatus.SENDING || delivery.claimToken !== claimToken) throw new Error("OutboundDelivery is not sending");
    const { claimedAt: _claimedAt, leaseUntil: _leaseUntil, claimToken: _claimToken, ...withoutClaim } = delivery;
    const updated = { ...withoutClaim, ...failure };
    this.deliveries.get(businessId)!.set(id, updated);
    return updated;
  }

  private async require(businessId: string, id: string): Promise<OutboundDelivery> {
    const delivery = await this.findById(businessId, id);
    if (!delivery) throw new Error("OutboundDelivery not found");
    return delivery;
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

export class InMemoryQuoteDraftRepository implements QuoteDraftRepository {
  private readonly drafts = new Map<string, Map<string, QuoteDraft>>();
  async findById(businessId: string, id: string): Promise<QuoteDraft | null> { return cloneDraft(this.drafts.get(businessId)?.get(id)); }
  async findLatestByQuoteRequest(businessId: string, quoteRequestId: string): Promise<QuoteDraft | null> {
    const drafts = [...(this.drafts.get(businessId)?.values() ?? [])].filter((draft) => draft.quoteRequestId === quoteRequestId).sort((left, right) => right.revision - left.revision || right.id.localeCompare(left.id));
    return cloneDraft(drafts[0]);
  }
  async save(entity: QuoteDraft): Promise<void> {
    let businessDrafts = this.drafts.get(entity.businessId);
    if (!businessDrafts) { businessDrafts = new Map(); this.drafts.set(entity.businessId, businessDrafts); }
    assertDraftSave(cloneDraft(businessDrafts.get(entity.id)), entity);
    if ([...businessDrafts.values()].some((draft) => draft.id !== entity.id && draft.quoteRequestId === entity.quoteRequestId && draft.revision === entity.revision)) throw new QuoteDraftError("QUOTE_DRAFT_CONFLICT");
    businessDrafts.set(entity.id, cloneDraft(entity)!);
  }
  async approve(businessId: string, id: string, authorizedAt: string): Promise<void> {
    const draft = this.drafts.get(businessId)?.get(id);
    if (!draft || draft.status !== QuoteDraftStatus.PENDING_APPROVAL) throw new QuoteDraftError("DRAFT_NOT_APPROVABLE");
    this.drafts.get(businessId)!.set(id, { ...draft, status: QuoteDraftStatus.APPROVED, authorizedAt, updatedAt: authorizedAt });
  }
  async markPublished(businessId: string, id: string, updatedAt: string): Promise<void> {
    const draft = this.drafts.get(businessId)?.get(id);
    if (!draft || (draft.status !== QuoteDraftStatus.APPROVED && draft.status !== QuoteDraftStatus.PUBLISHED)) throw new QuoteDraftError("DRAFT_NOT_APPROVABLE");
    if (draft.status === QuoteDraftStatus.APPROVED) this.drafts.get(businessId)!.set(id, { ...draft, status: QuoteDraftStatus.PUBLISHED, updatedAt });
  }
}

export class InMemoryBusinessAssistantIntegrationSettingsRepository implements BusinessAssistantIntegrationSettingsRepository {
  private readonly settings = new Map<string, BusinessAssistantIntegrationSettings>();
  async findByBusinessId(businessId: string): Promise<BusinessAssistantIntegrationSettings | null> {
    const value = this.settings.get(businessId);
    return value ? { ...value } : null;
  }
  async save(value: BusinessAssistantIntegrationSettings): Promise<void> { this.settings.set(value.businessId, { ...value }); }
}

function cloneDraft(draft: QuoteDraft | undefined): QuoteDraft | null {
  if (!draft) return null;
  return { ...draft, lines: draft.lines.map((line) => ({ ...line, unitPriceCaptured: { ...line.unitPriceCaptured }, subtotal: { ...line.subtotal } })), productsSubtotal: { ...draft.productsSubtotal }, laborSubtotal: { ...draft.laborSubtotal }, total: { ...draft.total } };
}
