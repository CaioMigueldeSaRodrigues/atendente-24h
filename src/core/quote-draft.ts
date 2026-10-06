import type { Money } from "./domain/types.js";
import { QuoteDraftLineKind, QuoteDraftStatus } from "./domain/enums.js";
export { QuoteDraftLineKind, QuoteDraftStatus } from "./domain/enums.js";

export type QuoteDraftLine = {
  id: string;
  businessId: string;
  quoteDraftId: string;
  kind: QuoteDraftLineKind;
  description: string;
  externalReference?: string;
  quantity: number;
  unit: string;
  unitPriceCaptured: Money;
  subtotal: Money;
  source: string;
  checkedAt: string;
  quantitySource: "OPERATOR_CONFIRMED" | "WORKSHOP_SYSTEM";
};

export type QuoteDraft = {
  id: string;
  businessId: string;
  conversationId: string;
  quoteRequestId: string;
  vehicleId?: string;
  revision: number;
  status: QuoteDraftStatus;
  lines: QuoteDraftLine[];
  productsSubtotal: Money;
  laborSubtotal: Money;
  total: Money;
  createdAt: string;
  updatedAt: string;
  authorizedAt?: string;
};
