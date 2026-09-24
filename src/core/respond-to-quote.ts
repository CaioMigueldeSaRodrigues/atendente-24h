import type { CommercialEvent, Opportunity, QuoteRequest } from "./domain/entities.js";
import {
  CommercialEventType,
  OpportunityStatus,
  QuoteRequestStatus,
} from "./domain/enums.js";
import type { Money } from "./domain/types.js";
import type {
  OpportunityRepository,
  CommercialEventRepository,
  QuoteRequestRepository,
} from "./repositories.js";
import { appendCommercialEventSafely } from "./append-commercial-event-safely.js";

type RespondToQuoteBaseDependencies = {
  quoteRequestRepository: QuoteRequestRepository;
  opportunityRepository: OpportunityRepository;
  now: () => string;
};

export type RespondToQuoteInput = {
  businessId: string;
  quoteRequestId: string;
  authorizedPrice: Money;
};

export type RespondToQuoteDependencies = RespondToQuoteBaseDependencies & {
  commercialEventRepository?: CommercialEventRepository;
  generateId?: (prefix: string) => string;
};

export async function respondToQuote(
  input: RespondToQuoteInput,
  dependencies: RespondToQuoteDependencies,
) {
  const quoteRequest = await dependencies.quoteRequestRepository.findById(
    input.businessId,
    input.quoteRequestId,
  );

  if (!quoteRequest) {
    throw new Error("QuoteRequest not found");
  }

  const opportunity = await dependencies.opportunityRepository.findById(
    input.businessId,
    quoteRequest.opportunityId,
  );

  if (!opportunity) {
    throw new Error("Opportunity not found");
  }

  if (quoteRequest.status !== QuoteRequestStatus.WAITING_BUSINESS) {
    throw new Error("QuoteRequest cannot be responded");
  }

  if (!isValidAuthorizedPrice(input.authorizedPrice)) {
    throw new Error("authorizedPrice is invalid");
  }

  const now = dependencies.now();
  const updatedQuoteRequest: QuoteRequest = {
    ...quoteRequest,
    authorizedPrice: input.authorizedPrice,
    status: QuoteRequestStatus.RESPONDED,
    updatedAt: now,
  };
  const updatedOpportunity: Opportunity = {
    ...opportunity,
    status: OpportunityStatus.WAITING_CUSTOMER,
    nextAction: {
      type: "REQUEST_INFORMATION",
      description: "Aguardar a decisão do cliente sobre o orçamento",
    },
    updatedAt: now,
  };

  await dependencies.quoteRequestRepository.save(updatedQuoteRequest);
  await dependencies.opportunityRepository.save(updatedOpportunity);

  if (dependencies.commercialEventRepository !== undefined && dependencies.generateId !== undefined) {
    const generateId = dependencies.generateId;
    await appendCommercialEventSafely(dependencies.commercialEventRepository, () => {
      const event: CommercialEvent = {
        id: generateId("commercial-event"),
        businessId: updatedQuoteRequest.businessId,
        eventType: CommercialEventType.QUOTE_RESPONDED,
        conversationId: updatedQuoteRequest.conversationId,
        ...(updatedQuoteRequest.customerId !== undefined ? { customerId: updatedQuoteRequest.customerId } : {}),
        ...(updatedQuoteRequest.vehicleId !== undefined ? { vehicleId: updatedQuoteRequest.vehicleId } : {}),
        opportunityId: updatedQuoteRequest.opportunityId,
        quoteRequestId: updatedQuoteRequest.id,
        requestedItem: updatedQuoteRequest.requestDescription,
        ...(updatedQuoteRequest.symptomDescription !== undefined
          ? { symptom: updatedQuoteRequest.symptomDescription }
          : {}),
        amount: input.authorizedPrice,
        occurredAt: dependencies.now(),
      };
      return event;
    });
  }

  return {
    quoteRequestId: updatedQuoteRequest.id,
    opportunityId: updatedOpportunity.id,
    authorizedPrice: updatedQuoteRequest.authorizedPrice,
    quoteRequestStatus: updatedQuoteRequest.status,
    opportunityStatus: updatedOpportunity.status,
  };
}

function isValidAuthorizedPrice(value: Money): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isSafeInteger(value.amountCents) &&
    value.amountCents >= 0 &&
    value.currency === "BRL"
  );
}
