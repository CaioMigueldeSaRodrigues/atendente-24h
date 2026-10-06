import { QuoteDraftStatus, type QuoteDraft } from "./quote-draft.js";
import { QuoteDraftError } from "./build-quote-draft.js";
import { isDeepStrictEqual } from "node:util";

export function assertDraftSave(existing: QuoteDraft | null, incoming: QuoteDraft): void {
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
