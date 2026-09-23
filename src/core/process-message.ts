import { requiresExplicitHumanHandoff } from "./business-rules.js";
import { resolveSafeReply } from "./response-policy.js";
import { getMissingQuoteRequiredFields } from "./quote-intake-policy.js";
import type {
  Appointment,
  Conversation,
  Customer,
  HumanHandoff,
  Message,
  Opportunity,
  QuoteRequest,
  Vehicle,
} from "./domain/entities.js";
import {
  CommercialOutcome,
  AppointmentStatus,
  ConversationStatus,
  HandoffReason,
  HandoffStatus,
  Intent,
  OpportunityStatus,
  QuoteRequestStatus,
  SenderType,
} from "./domain/enums.js";
import type { AIInterpretation, NextAction } from "./domain/types.js";
import type {
  ConversationRepository,
  AppointmentRepository,
  CustomerRepository,
  HumanHandoffRepository,
  MessageRepository,
  OpportunityRepository,
  QuoteRequestRepository,
  VehicleRepository,
} from "./repositories.js";
import type { MessageInterpreter } from "./message-interpreter.js";

export type ProcessMessageInput = {
  businessId: string;
  conversationId: string;
  content: string;
};

export type ProcessMessageDependencies = {
  conversationRepository: ConversationRepository;
  appointmentRepository: AppointmentRepository;
  messageRepository: MessageRepository;
  customerRepository: CustomerRepository;
  vehicleRepository: VehicleRepository;
  humanHandoffRepository: HumanHandoffRepository;
  opportunityRepository: OpportunityRepository;
  quoteRequestRepository: QuoteRequestRepository;
  interpreter: MessageInterpreter;
  now: () => string;
  generateId: (prefix: string) => string;
};

export async function processMessage(
  input: ProcessMessageInput,
  dependencies: ProcessMessageDependencies,
) {
  const conversation = await dependencies.conversationRepository.findById(
    input.businessId,
    input.conversationId,
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const customerMessage: Message = {
    id: dependencies.generateId("message"),
    businessId: conversation.businessId,
    conversationId: conversation.id,
    senderType: SenderType.CUSTOMER,
    channel: conversation.channel,
    content: input.content,
    createdAt: dependencies.now(),
  };
  await dependencies.messageRepository.save(customerMessage);

  const history = await dependencies.messageRepository.listByConversation(
    conversation.businessId,
    conversation.id,
  );
  const interpretation: AIInterpretation =
    await dependencies.interpreter.interpret({
      businessId: conversation.businessId,
      conversationId: conversation.id,
      content: input.content,
      history,
    });

  const requiresHuman =
    requiresExplicitHumanHandoff(interpretation.intent) ||
    interpretation.requiresHuman;

  const customerUpdates = Object.fromEntries(
    Object.entries(interpretation.extractedCustomerData).filter(
      ([, value]) => typeof value === "string" && value.trim().length > 0,
    ),
  ) as typeof interpretation.extractedCustomerData;
  const hasUsefulCustomerData = Object.keys(customerUpdates).length > 0;

  let customerId = conversation.customerId;
  let existingCustomer = customerId
    ? await dependencies.customerRepository.findById(
        conversation.businessId,
        customerId,
      )
    : null;

  if (existingCustomer && hasUsefulCustomerData) {
    existingCustomer = {
      ...existingCustomer,
      ...customerUpdates,
      updatedAt: dependencies.now(),
    };
    await dependencies.customerRepository.save(existingCustomer);
  } else if (customerId === undefined && hasUsefulCustomerData) {
    const now = dependencies.now();
    const customer: Customer = {
      id: dependencies.generateId("customer"),
      businessId: conversation.businessId,
      ...customerUpdates,
      createdAt: now,
      updatedAt: now,
    };
    await dependencies.customerRepository.save(customer);
    customerId = customer.id;
    existingCustomer = customer;
  }

  const extractedVehicleData = interpretation.extractedVehicleData;
  const vehicleUpdates = Object.fromEntries(
    Object.entries(extractedVehicleData).filter(([, value]) => value !== undefined),
  ) as typeof extractedVehicleData;
  const hasUsefulVehicleData = Object.values(vehicleUpdates).some((value) =>
    typeof value === "string" ? value.trim().length > 0 : value !== undefined,
  );

  let vehicleId = conversation.vehicleId;
  let existingVehicle = vehicleId
    ? await dependencies.vehicleRepository.findById(
        conversation.businessId,
        vehicleId,
      )
    : null;
  let effectiveVehicleData = vehicleUpdates;

  if (existingVehicle) {
    const customerAssociation = customerId !== undefined &&
        existingVehicle.customerId !== customerId
      ? { customerId }
      : {};
    if (
      Object.keys(vehicleUpdates).length > 0 ||
      Object.keys(customerAssociation).length > 0
    ) {
      existingVehicle = {
        ...existingVehicle,
        ...vehicleUpdates,
        ...customerAssociation,
        updatedAt: dependencies.now(),
      };
      await dependencies.vehicleRepository.save(existingVehicle);
    }
    effectiveVehicleData = { ...existingVehicle, ...vehicleUpdates };
  } else if (vehicleId === undefined && hasUsefulVehicleData) {
    const now = dependencies.now();
    const vehicle: Vehicle = {
      id: dependencies.generateId("vehicle"),
      businessId: conversation.businessId,
      ...(customerId !== undefined
        ? { customerId }
        : {}),
      ...vehicleUpdates,
      createdAt: now,
      updatedAt: now,
    };
    await dependencies.vehicleRepository.save(vehicle);
    vehicleId = vehicle.id;
    existingVehicle = vehicle;
    effectiveVehicleData = vehicle;
  }

  const quoteRequested = interpretation.intent === Intent.QUOTE_REQUEST;
  const quoteMissingData = quoteRequested
    ? getMissingQuoteRequiredFields(effectiveVehicleData)
    : [];
  const quoteNextAction: NextAction = quoteMissingData.length > 0
    ? {
        type: "REQUEST_INFORMATION",
        description: "Solicitar informações necessárias para o orçamento",
      }
    : {
        type: "PROVIDE_QUOTE",
        description: "Fornecer orçamento ao cliente",
      };
  const reply = resolveSafeReply({
    intent: interpretation.intent,
    proposedResponse: interpretation.proposedResponse,
    requiresHuman,
    suggestedNextAction: quoteRequested
      ? quoteNextAction
      : interpretation.suggestedNextAction,
    missingData: quoteRequested
      ? quoteMissingData
      : interpretation.missingData,
  });

  const appointmentRequested =
    interpretation.intent === Intent.APPOINTMENT_REQUEST;

  if (quoteRequested) {
    const now = dependencies.now();
    const waitingForCustomer = quoteMissingData.length > 0 && !requiresHuman;
    const opportunityStatus = waitingForCustomer
      ? OpportunityStatus.WAITING_CUSTOMER
      : OpportunityStatus.WAITING_BUSINESS;
    const quoteRequestStatus = waitingForCustomer
      ? QuoteRequestStatus.WAITING_INFORMATION
      : QuoteRequestStatus.WAITING_BUSINESS;

    const opportunities = await dependencies.opportunityRepository.listByConversation(
      conversation.businessId,
      conversation.id,
    );
    const activeOpportunity = opportunities
      .filter(({ status }) =>
        status === OpportunityStatus.OPEN ||
        status === OpportunityStatus.WAITING_CUSTOMER ||
        status === OpportunityStatus.WAITING_BUSINESS,
      )
      .at(-1);
    const quoteRequests = await dependencies.quoteRequestRepository.listByConversation(
      conversation.businessId,
      conversation.id,
    );
    const activeQuoteRequest = activeOpportunity
      ? quoteRequests
          .filter((quoteRequest) =>
            quoteRequest.opportunityId === activeOpportunity.id &&
            (quoteRequest.status === QuoteRequestStatus.REQUESTED ||
              quoteRequest.status === QuoteRequestStatus.WAITING_INFORMATION ||
              quoteRequest.status === QuoteRequestStatus.WAITING_BUSINESS),
          )
          .at(-1)
      : undefined;

    if (activeOpportunity && activeQuoteRequest) {
      await dependencies.opportunityRepository.save({
        ...activeOpportunity,
        ...(customerId !== undefined ? { customerId } : {}),
        requestDescription:
          interpretation.requestedItem ?? activeOpportunity.requestDescription ?? input.content,
        status: opportunityStatus,
        nextAction: quoteNextAction,
        updatedAt: now,
      });

      await dependencies.quoteRequestRepository.save({
        ...activeQuoteRequest,
        ...(customerId !== undefined ? { customerId } : {}),
        requestDescription:
          interpretation.requestedItem ?? activeQuoteRequest.requestDescription,
        ...(interpretation.symptomDescription !== undefined
          ? { symptomDescription: interpretation.symptomDescription }
          : {}),
        status: quoteRequestStatus,
        updatedAt: now,
      });
    } else {
      const requestDescription =
        interpretation.requestedItem ?? input.content;
      const opportunity: Opportunity = {
        id: dependencies.generateId("opportunity"),
        businessId: conversation.businessId,
        conversationId: conversation.id,
        ...(customerId !== undefined
          ? { customerId }
          : {}),
        ...(vehicleId !== undefined
          ? { vehicleId }
          : {}),
        requestDescription,
        status: opportunityStatus,
        nextAction: quoteNextAction,
        createdAt: now,
        updatedAt: now,
      };
      await dependencies.opportunityRepository.save(opportunity);

      const quoteRequest: QuoteRequest = {
        id: dependencies.generateId("quote"),
        businessId: conversation.businessId,
        opportunityId: opportunity.id,
        conversationId: conversation.id,
        ...(customerId !== undefined
          ? { customerId }
          : {}),
        ...(vehicleId !== undefined
          ? { vehicleId }
          : {}),
        requestDescription,
        ...(interpretation.symptomDescription !== undefined
          ? { symptomDescription: interpretation.symptomDescription }
          : {}),
        status: quoteRequestStatus,
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await dependencies.quoteRequestRepository.save(quoteRequest);
    }
  }

  if (appointmentRequested) {
    const now = dependencies.now();
    const appointment: Appointment = {
      id: dependencies.generateId("appointment"),
      businessId: conversation.businessId,
      conversationId: conversation.id,
      ...(conversation.customerId !== undefined
        ? { customerId: conversation.customerId }
        : {}),
      ...(vehicleId !== undefined
        ? { vehicleId }
        : {}),
      status: AppointmentStatus.REQUESTED,
      requestDescription: interpretation.requestedItem ?? input.content,
      createdAt: now,
      updatedAt: now,
    };
    await dependencies.appointmentRepository.save(appointment);
  }

  if (requiresHuman) {
    const now = dependencies.now();
    const handoffReason =
      interpretation.intent === Intent.HUMAN_REQUEST
        ? HandoffReason.CUSTOMER_REQUEST
        : (interpretation.handoffReason ?? HandoffReason.OTHER);
    const handoff: HumanHandoff = {
      id: dependencies.generateId("handoff"),
      businessId: conversation.businessId,
      conversationId: conversation.id,
      reason: handoffReason,
      summary: input.content,
      status: HandoffStatus.REQUESTED,
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await dependencies.humanHandoffRepository.save(handoff);
  }

  let updatedConversation: Conversation = {
    ...conversation,
    ...(customerId !== undefined ? { customerId } : {}),
    ...(vehicleId !== undefined ? { vehicleId } : {}),
    currentIntent: interpretation.intent,
    lastMessageAt: dependencies.now(),
  };

  if (quoteRequested) {
    updatedConversation = {
      ...updatedConversation,
      commercialOutcome: CommercialOutcome.QUOTE_REQUESTED,
    };
  }

  if (appointmentRequested) {
    updatedConversation = {
      ...updatedConversation,
      commercialOutcome: CommercialOutcome.APPOINTMENT_REQUESTED,
    };
  }

  if (requiresHuman) {
    updatedConversation = {
      ...updatedConversation,
      status: ConversationStatus.WAITING_HUMAN,
      commercialOutcome: CommercialOutcome.HUMAN_HANDOFF,
    };
  }

  await dependencies.conversationRepository.save(updatedConversation);

  const assistantMessage: Message = {
    id: dependencies.generateId("message"),
    businessId: conversation.businessId,
    conversationId: conversation.id,
    senderType: SenderType.ASSISTANT,
    channel: conversation.channel,
    content: reply,
    createdAt: dependencies.now(),
  };
  await dependencies.messageRepository.save(assistantMessage);

  return {
    conversationId: updatedConversation.id,
    reply,
    intent: interpretation.intent,
    conversationStatus: updatedConversation.status,
    commercialOutcome: updatedConversation.commercialOutcome,
    requiresHuman,
  };
}
