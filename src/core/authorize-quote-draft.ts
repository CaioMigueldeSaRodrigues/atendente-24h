import { respondToQuote } from "./respond-to-quote.js";
import { QuoteDraftStatus, type QuoteDraft } from "./quote-draft.js";
import type { QuoteDraftRepository, QuoteRequestRepository, OpportunityRepository, CommercialEventRepository } from "./repositories.js";
import { QuoteDraftError } from "./build-quote-draft.js";
import type { QuotePersistenceTransaction } from "./quote-persistence-transaction.js";

export async function authorizeQuoteDraft(input: { businessId: string; quoteRequestId: string }, dependencies: {
  quoteDraftRepository: QuoteDraftRepository; quoteRequestRepository: QuoteRequestRepository; opportunityRepository: OpportunityRepository;
  commercialEventRepository?: CommercialEventRepository; now: () => string; generateId?: (prefix: string) => string;
  quoteTransaction: QuotePersistenceTransaction;
}): Promise<QuoteDraft> {
  return dependencies.quoteTransaction.run(input.businessId, input.quoteRequestId, async () => {
    const draft = await dependencies.quoteDraftRepository.findLatestByQuoteRequest(input.businessId, input.quoteRequestId);
    if (!draft || draft.status !== QuoteDraftStatus.PENDING_APPROVAL) throw new QuoteDraftError("DRAFT_NOT_APPROVABLE", "Current quote draft is not pending approval");
    await respondToQuote({ businessId: input.businessId, quoteRequestId: input.quoteRequestId, authorizedPrice: draft.total }, dependencies);
    const authorizedAt = dependencies.now();
    await dependencies.quoteDraftRepository.approve(input.businessId, draft.id, authorizedAt);
    return { ...draft, status: QuoteDraftStatus.APPROVED, authorizedAt, updatedAt: authorizedAt };
  });
}
