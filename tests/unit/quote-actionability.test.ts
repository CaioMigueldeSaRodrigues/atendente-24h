import assert from "node:assert/strict";
import test from "node:test";
import { isQuoteOperatorActionable, isQuoteSendActionable } from "../../src/core/quote-actionability.js";
import { OutboundDeliveryStatus, QuoteRequestStatus } from "../../src/core/domain/enums.js";

test("responded quote actionability follows provider delivery truth", () => {
  assert.equal(isQuoteSendActionable(QuoteRequestStatus.RESPONDED, null), true);
  assert.equal(isQuoteSendActionable(QuoteRequestStatus.RESPONDED, OutboundDeliveryStatus.FAILED_RETRYABLE), true);
  assert.equal(isQuoteSendActionable(QuoteRequestStatus.RESPONDED, "ACCEPTED_BY_PROVIDER"), false);
  assert.equal(isQuoteSendActionable(QuoteRequestStatus.RESPONDED, OutboundDeliveryStatus.DELIVERED), false);
  assert.equal(isQuoteSendActionable(QuoteRequestStatus.RESPONDED, "READ"), false);
  assert.equal(isQuoteSendActionable(QuoteRequestStatus.RESPONDED, OutboundDeliveryStatus.SENDING), false);
  assert.equal(isQuoteSendActionable(QuoteRequestStatus.RESPONDED, OutboundDeliveryStatus.PENDING), false);
  assert.equal(isQuoteSendActionable(QuoteRequestStatus.RESPONDED, OutboundDeliveryStatus.FAILED_FINAL), false);
});

test("waiting for the workshop remains actionable for authorization", () => {
  assert.equal(isQuoteOperatorActionable(QuoteRequestStatus.WAITING_BUSINESS, null), true);
  assert.equal(isQuoteOperatorActionable(QuoteRequestStatus.WAITING_BUSINESS, OutboundDeliveryStatus.DELIVERED), true);
});
