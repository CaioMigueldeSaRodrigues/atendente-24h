import type { Opportunity, QuoteRequest } from "./domain/entities.js";
import {
  OpportunityStatus,
  QuoteRequestStatus,
} from "./domain/enums.js";
import type { Money } from "./domain/types.js";
import type {
  OpportunityRepository,
  QuoteRequestRepository,
} from "./repositories.js";

export type RespondToQuoteInput = {
  businessId: string;
  quoteRequestId: string;
  authorizedPrice: Money;
};

export type RespondToQuoteDependencies = {
  quoteRequestRepository: QuoteRequestRepository;
  opportunityRepository: OpportunityRepository;
  now: () => string;
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
