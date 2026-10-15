import { OutboundDeliveryStatus, QuoteRequestStatus } from "./domain/enums.js";

export type QuoteDeliveryTruthStatus = OutboundDeliveryStatus | "ACCEPTED_BY_PROVIDER" | "READ";

/** Only a missing delivery or an explicitly retryable failure may be sent. */
export function isQuoteSendActionable(
  quoteStatus: QuoteRequestStatus,
  deliveryStatus: QuoteDeliveryTruthStatus | null | undefined,
): boolean {
  if (quoteStatus !== QuoteRequestStatus.RESPONDED) return false;
  return deliveryStatus === null || deliveryStatus === undefined || deliveryStatus === OutboundDeliveryStatus.FAILED_RETRYABLE;
}

export function isQuoteOperatorActionable(
  quoteStatus: QuoteRequestStatus,
  deliveryStatus: QuoteDeliveryTruthStatus | null | undefined,
): boolean {
  if (quoteStatus === QuoteRequestStatus.RESPONDED) return isQuoteSendActionable(quoteStatus, deliveryStatus);
  return true;
}
