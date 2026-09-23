import assert from "node:assert/strict";
import test from "node:test";
import type { QuoteRequest } from "../../src/core/domain/entities.js";
import { QuoteRequestStatus } from "../../src/core/domain/enums.js";
import { buildAuthorizedQuoteReply } from "../../src/core/quote-presentation.js";

const makeQuoteRequest = (
  overrides: Partial<QuoteRequest> = {},
): QuoteRequest => ({
  id: "quote-1",
  businessId: "business-1",
  opportunityId: "opportunity-1",
  conversationId: "conversation-1",
  requestDescription: "Pastilhas de freio",
  status: QuoteRequestStatus.RESPONDED,
  requestedAt: "2026-01-01T12:00:00.000Z",
  createdAt: "2026-01-01T12:00:00.000Z",
  updatedAt: "2026-01-02T12:00:00.000Z",
  authorizedPrice: { amountCents: 12500, currency: "BRL" },
  ...overrides,
});

test("builds the exact reply using the authorized price", () => {
  const quoteRequest = makeQuoteRequest();

  assert.equal(
    buildAuthorizedQuoteReply(quoteRequest),
    "O orçamento autorizado é de R$ 125,00. Deseja prosseguir?",
  );
});

test("formats thousands and cents without floating-point rounding", () => {
  const quoteRequest = makeQuoteRequest({
    authorizedPrice: { amountCents: 125050, currency: "BRL" },
  });

  assert.equal(
    buildAuthorizedQuoteReply(quoteRequest),
    "O orçamento autorizado é de R$ 1.250,50. Deseja prosseguir?",
  );
});

test("formats a zero authorized price", () => {
  const quoteRequest = makeQuoteRequest({
    authorizedPrice: { amountCents: 0, currency: "BRL" },
  });

  assert.equal(
    buildAuthorizedQuoteReply(quoteRequest),
    "O orçamento autorizado é de R$ 0,00. Deseja prosseguir?",
  );
});

test("does not present a price while waiting for the business", () => {
  const quoteRequest = makeQuoteRequest({
    status: QuoteRequestStatus.WAITING_BUSINESS,
  });

  assert.throws(
    () => buildAuthorizedQuoteReply(quoteRequest),
    { message: "Authorized price cannot be presented" },
  );
});

test("does not present a responded quote without an authorized price", () => {
  const quoteRequest = makeQuoteRequest();
  delete quoteRequest.authorizedPrice;

  assert.throws(
    () => buildAuthorizedQuoteReply(quoteRequest),
    { message: "Authorized price cannot be presented" },
  );
});

test("does not present a cancelled quote", () => {
  const quoteRequest = makeQuoteRequest({ status: QuoteRequestStatus.CANCELLED });

  assert.throws(
    () => buildAuthorizedQuoteReply(quoteRequest),
    { message: "Authorized price cannot be presented" },
  );
});

test("does not present a closed quote", () => {
  const quoteRequest = makeQuoteRequest({ status: QuoteRequestStatus.CLOSED });

  assert.throws(
    () => buildAuthorizedQuoteReply(quoteRequest),
    { message: "Authorized price cannot be presented" },
  );
});

test("does not mutate the QuoteRequest", () => {
  const quoteRequest = makeQuoteRequest();
  const original = structuredClone(quoteRequest);

  buildAuthorizedQuoteReply(quoteRequest);

  assert.deepEqual(quoteRequest, original);
});

test("includes exactly the authorized amount in the reply", () => {
  const quoteRequest = makeQuoteRequest({
    authorizedPrice: { amountCents: 987654, currency: "BRL" },
  });
  const reply = buildAuthorizedQuoteReply(quoteRequest);

  assert.equal(reply, "O orçamento autorizado é de R$ 9.876,54. Deseja prosseguir?");
});
