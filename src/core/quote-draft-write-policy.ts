import { QuoteDraftStatus, type QuoteDraft } from "./quote-draft.js";
import { QuoteDraftError } from "./build-quote-draft.js";
import { isDeepStrictEqual } from "node:util";

export function assertQuoteDraftInvariants(draft: QuoteDraft): void {
  if (!Number.isSafeInteger(draft.revision) || draft.revision <= 0) throw new QuoteDraftError("DRAFT_IMMUTABLE", "Draft revision is invalid");
  let products = 0;
  let labor = 0;
  for (const line of draft.lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new QuoteDraftError("DRAFT_IMMUTABLE", "Draft quantity is invalid");
    if (line.quantitySource !== "OPERATOR_CONFIRMED" && line.quantitySource !== "WORKSHOP_SYSTEM") throw new QuoteDraftError("DRAFT_IMMUTABLE", "Draft quantity source is invalid");
    for (const money of [line.unitPriceCaptured, line.subtotal]) if (!Number.isSafeInteger(money.amountCents) || money.amountCents < 0 || money.amountCents > Number.MAX_SAFE_INTEGER) throw new QuoteDraftError("DRAFT_IMMUTABLE", "Draft money is invalid");
    if (line.unitPriceCaptured.currency !== "BRL" || line.subtotal.currency !== "BRL") throw new QuoteDraftError("DRAFT_IMMUTABLE", "Draft currency is invalid");
    if (line.subtotal.amountCents !== line.quantity * line.unitPriceCaptured.amountCents) throw new QuoteDraftError("DRAFT_IMMUTABLE", "Draft line total is invalid");
    if (line.kind === "PRODUCT") products += line.subtotal.amountCents;
    else if (line.kind === "LABOR") labor += line.subtotal.amountCents;
    else throw new QuoteDraftError("DRAFT_IMMUTABLE", "Draft line kind is invalid");
  }
  for (const money of [draft.productsSubtotal, draft.laborSubtotal, draft.total]) if (!Number.isSafeInteger(money.amountCents) || money.amountCents < 0 || money.amountCents > Number.MAX_SAFE_INTEGER || money.currency !== "BRL") throw new QuoteDraftError("DRAFT_IMMUTABLE", "Draft total is invalid");
  if (draft.productsSubtotal.amountCents !== products || draft.laborSubtotal.amountCents !== labor || draft.total.amountCents !== products + labor) throw new QuoteDraftError("DRAFT_IMMUTABLE", "Draft totals are inconsistent");
}

export function assertDraftSave(existing: QuoteDraft | null, incoming: QuoteDraft): void {
  assertQuoteDraftInvariants(incoming);
  if (!existing) {
    if (incoming.status !== QuoteDraftStatus.PENDING_APPROVAL) throw new QuoteDraftError("DRAFT_IMMUTABLE");
    return;
  }
  if (!isDeepStrictEqual(snapshot(existing), snapshot(incoming))) throw new QuoteDraftError("DRAFT_IMMUTABLE");
  if (existing.status === QuoteDraftStatus.APPROVED || existing.status === QuoteDraftStatus.PUBLISHED) {
    if (!isDeepStrictEqual(existing, incoming)) throw new QuoteDraftError("DRAFT_IMMUTABLE");
    return;
  }
  if (existing.status !== incoming.status && !(existing.status === QuoteDraftStatus.PENDING_APPROVAL && incoming.status === QuoteDraftStatus.SUPERSEDED)) {
    throw new QuoteDraftError("DRAFT_IMMUTABLE");
  }
}

function snapshot(draft: QuoteDraft): unknown {
  const { status: _status, updatedAt: _updatedAt, authorizedAt: _authorizedAt, lines, ...value } = draft;
  return { ...value, lines: [...lines].sort((a, b) => a.id.localeCompare(b.id)) };
}
