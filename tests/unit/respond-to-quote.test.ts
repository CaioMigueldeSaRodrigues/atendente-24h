import assert from "node:assert/strict";
import test from "node:test";
import type { Opportunity, QuoteRequest } from "../../src/core/domain/entities.js";
import {
  OpportunityStatus,
  QuoteRequestStatus,
} from "../../src/core/domain/enums.js";
import type { Money } from "../../src/core/domain/types.js";
import { canPresentAuthorizedPrice } from "../../src/core/business-rules.js";
import {
  InMemoryOpportunityRepository,
  InMemoryQuoteRequestRepository,
} from "../../src/core/in-memory-repositories.js";
import { respondToQuote } from "../../src/core/respond-to-quote.js";

const timestamp = "2026-01-01T12:00:00.000Z";
const responseTime = "2026-01-02T12:00:00.000Z";

const makeOpportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: "opportunity-1",
  businessId: "business-1",
  conversationId: "conversation-1",
  customerId: "customer-1",
  vehicleId: "vehicle-1",
  requestDescription: "Pastilhas de freio",
  status: OpportunityStatus.WAITING_BUSINESS,
  nextAction: { type: "PROVIDE_QUOTE", description: "Fornecer orçamento" },
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const makeQuoteRequest = (overrides: Partial<QuoteRequest> = {}): QuoteRequest => ({
  id: "quote-1",
  businessId: "business-1",
  opportunityId: "opportunity-1",
  conversationId: "conversation-1",
  customerId: "customer-1",
  vehicleId: "vehicle-1",
  requestDescription: "Pastilhas de freio",
  status: QuoteRequestStatus.WAITING_BUSINESS,
  requestedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const setup = async ({
  quoteRequest = makeQuoteRequest(),
  opportunity = makeOpportunity(),
}: {
  quoteRequest?: QuoteRequest;
  opportunity?: Opportunity | null;
} = {}) => {
  const quoteRequestRepository = new InMemoryQuoteRequestRepository();
  const opportunityRepository = new InMemoryOpportunityRepository();
  await quoteRequestRepository.save(quoteRequest);
  if (opportunity) {
    await opportunityRepository.save(opportunity);
  }

  return {
    quoteRequestRepository,
    opportunityRepository,
    dependencies: {
      quoteRequestRepository,
      opportunityRepository,
      now: () => responseTime,
    },
  };
};

const input = (overrides: Partial<{
  businessId: string;
  quoteRequestId: string;
  authorizedPrice: Money;
}> = {}) => ({
  businessId: "business-1",
  quoteRequestId: "quote-1",
  authorizedPrice: { amountCents: 12500, currency: "BRL" as const },
  ...overrides,
});

test("responds to a quote waiting for the business with an authorized price", async () => {
  const harness = await setup();

  const result = await respondToQuote(input(), harness.dependencies);

  assert.deepEqual(result, {
    quoteRequestId: "quote-1",
    opportunityId: "opportunity-1",
    authorizedPrice: { amountCents: 12500, currency: "BRL" },
    quoteRequestStatus: QuoteRequestStatus.RESPONDED,
    opportunityStatus: OpportunityStatus.WAITING_CUSTOMER,
  });
});

test("preserves quote identifiers, relationships, and creation timestamps", async () => {
  const originalQuote = makeQuoteRequest();
  const originalOpportunity = makeOpportunity();
  const harness = await setup({ quoteRequest: originalQuote, opportunity: originalOpportunity });

  await respondToQuote(input(), harness.dependencies);

  const quote = await harness.quoteRequestRepository.findById("business-1", "quote-1");
  const opportunity = await harness.opportunityRepository.findById("business-1", "opportunity-1");
  assert.deepEqual(quote, {
    ...originalQuote,
    authorizedPrice: { amountCents: 12500, currency: "BRL" },
    status: QuoteRequestStatus.RESPONDED,
    updatedAt: responseTime,
  });
  assert.deepEqual(opportunity, {
    ...originalOpportunity,
    status: OpportunityStatus.WAITING_CUSTOMER,
    nextAction: {
      type: "REQUEST_INFORMATION",
      description: "Aguardar a decisão do cliente sobre o orçamento",
    },
    updatedAt: responseTime,
  });
});

test("cannot find a QuoteRequest under another business", async () => {
  const harness = await setup();

  await assert.rejects(
    respondToQuote(input({ businessId: "business-2" }), harness.dependencies),
    { message: "QuoteRequest not found" },
  );
});

test("rejects a missing QuoteRequest", async () => {
  const harness = await setup();

  await assert.rejects(
    respondToQuote(input({ quoteRequestId: "missing" }), harness.dependencies),
    { message: "QuoteRequest not found" },
  );
});

test("rejects when the linked Opportunity does not exist", async () => {
  const harness = await setup({ opportunity: null });

  await assert.rejects(
    respondToQuote(input(), harness.dependencies),
    { message: "Opportunity not found" },
  );
});

test("does not respond to a QuoteRequest that is already responded", async () => {
  const harness = await setup({
    quoteRequest: makeQuoteRequest({ status: QuoteRequestStatus.RESPONDED }),
  });

  await assert.rejects(respondToQuote(input(), harness.dependencies), {
    message: "QuoteRequest cannot be responded",
  });
});

test("does not respond to a cancelled QuoteRequest", async () => {
  const harness = await setup({
    quoteRequest: makeQuoteRequest({ status: QuoteRequestStatus.CANCELLED }),
  });

  await assert.rejects(respondToQuote(input(), harness.dependencies), {
    message: "QuoteRequest cannot be responded",
  });
});

test("does not respond to a closed QuoteRequest", async () => {
  const harness = await setup({
    quoteRequest: makeQuoteRequest({ status: QuoteRequestStatus.CLOSED }),
  });

  await assert.rejects(respondToQuote(input(), harness.dependencies), {
    message: "QuoteRequest cannot be responded",
  });
});

test("rejects invalid authorized prices", async (t) => {
  const invalidPrices = [
    { amountCents: -1, currency: "BRL" },
    { amountCents: Number.NaN, currency: "BRL" },
    { amountCents: Number.POSITIVE_INFINITY, currency: "BRL" },
    { amountCents: 1.5, currency: "BRL" },
    { amountCents: 100, currency: "USD" },
    {},
    null,
  ];

  for (const price of invalidPrices) {
    await t.test(JSON.stringify(price), async () => {
      const harness = await setup();

      await assert.rejects(
        respondToQuote(
          input({ authorizedPrice: price as Money }),
          harness.dependencies,
        ),
        { message: "authorizedPrice is invalid" },
      );
    });
  }
});

test("authorized price makes the responded quote presentable", async () => {
  const harness = await setup();

  await respondToQuote(input(), harness.dependencies);

  const quote = await harness.quoteRequestRepository.findById("business-1", "quote-1");
  assert.ok(quote);
  assert.equal(canPresentAuthorizedPrice(quote), true);
});
