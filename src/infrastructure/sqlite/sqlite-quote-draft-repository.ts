import type { DatabaseSync } from "node:sqlite";
import type { QuoteDraft, QuoteDraftLine, QuoteDraftLineKind, QuoteDraftStatus } from "../../core/quote-draft.js";
import type { QuoteDraftRepository } from "../../core/repositories.js";
import { withSqliteConnectionLock, withSqliteTransaction } from "./sqlite-connection-lock.js";
import { assertDraftSave } from "../../core/quote-draft-write-policy.js";
import { QuoteDraftError } from "../../core/build-quote-draft.js";

type Row = Record<string, unknown>;
const text = (row: Row, key: string) => String(row[key]);
const optionalText = (row: Row, key: string) => row[key] == null ? undefined : String(row[key]);
const numberValue = (row: Row, key: string) => Number(row[key]);

export class SqliteQuoteDraftRepository implements QuoteDraftRepository {
  constructor(private readonly database: DatabaseSync) {}

  async findById(businessId: string, id: string): Promise<QuoteDraft | null> {
    return this.loadDraft(businessId, id);
  }

  async findLatestByQuoteRequest(businessId: string, quoteRequestId: string): Promise<QuoteDraft | null> {
    const row = await withSqliteConnectionLock(this.database, () => this.database.prepare("SELECT id FROM quote_drafts WHERE business_id = ? AND quote_request_id = ? ORDER BY revision DESC, id DESC LIMIT 1").get(businessId, quoteRequestId) as Row | undefined);
    return row === undefined ? null : this.loadDraft(businessId, text(row, "id"));
  }

  async save(entity: QuoteDraft): Promise<void> {
    await withSqliteTransaction(this.database, async () => {
      const existing = await this.loadDraft(entity.businessId, entity.id);
      assertDraftSave(existing, entity);
      if (existing) {
        this.database.prepare("UPDATE quote_drafts SET status=?, updated_at=? WHERE business_id=? AND id=?").run(entity.status, entity.updatedAt, entity.businessId, entity.id);
        return;
      }
      this.database.prepare(`INSERT INTO quote_drafts(id,business_id,conversation_id,quote_request_id,vehicle_id,revision,status,products_subtotal_amount_cents,products_subtotal_currency,labor_subtotal_amount_cents,labor_subtotal_currency,total_amount_cents,total_currency,created_at,updated_at,authorized_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        entity.id, entity.businessId, entity.conversationId, entity.quoteRequestId, entity.vehicleId ?? null, entity.revision, entity.status,
        entity.productsSubtotal.amountCents, entity.productsSubtotal.currency, entity.laborSubtotal.amountCents, entity.laborSubtotal.currency,
        entity.total.amountCents, entity.total.currency, entity.createdAt, entity.updatedAt, entity.authorizedAt ?? null,
      );
      for (const line of entity.lines) {
        this.database.prepare(`INSERT INTO quote_draft_lines(id,business_id,quote_draft_id,kind,description,external_reference,quantity,unit,unit_price_captured_amount_cents,unit_price_captured_currency,subtotal_amount_cents,subtotal_currency,source,checked_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          line.id, line.businessId, line.quoteDraftId, line.kind, line.description, line.externalReference ?? null, line.quantity, line.unit,
          line.unitPriceCaptured.amountCents, line.unitPriceCaptured.currency, line.subtotal.amountCents, line.subtotal.currency, line.source, line.checkedAt,
        );
      }
    });
  }

  async approve(businessId: string, id: string, authorizedAt: string): Promise<void> {
    await withSqliteConnectionLock(this.database, () => {
      const result = this.database.prepare("UPDATE quote_drafts SET status='APPROVED', authorized_at=?, updated_at=? WHERE business_id=? AND id=? AND status='PENDING_APPROVAL'").run(authorizedAt, authorizedAt, businessId, id);
      if (result.changes !== 1) throw new QuoteDraftError("DRAFT_NOT_APPROVABLE");
    });
  }

  async markPublished(businessId: string, id: string, updatedAt: string): Promise<void> {
    await withSqliteConnectionLock(this.database, () => {
      const result = this.database.prepare("UPDATE quote_drafts SET status='PUBLISHED', updated_at=? WHERE business_id=? AND id=? AND status='APPROVED'").run(updatedAt, businessId, id);
      if (result.changes !== 1) {
        const row = this.database.prepare("SELECT status FROM quote_drafts WHERE business_id=? AND id=?").get(businessId, id) as { status: string } | undefined;
        if (row?.status !== "PUBLISHED") throw new QuoteDraftError("DRAFT_NOT_APPROVABLE");
      }
    });
  }

  private async loadDraft(businessId: string, id: string): Promise<QuoteDraft | null> {
    const row = await withSqliteConnectionLock(this.database, () => this.database.prepare("SELECT * FROM quote_drafts WHERE business_id = ? AND id = ?").get(businessId, id) as Row | undefined);
    if (!row) return null;
    const lines = await withSqliteConnectionLock(this.database, () => this.database.prepare("SELECT * FROM quote_draft_lines WHERE business_id = ? AND quote_draft_id = ? ORDER BY id").all(businessId, id) as Row[]);
    return mapDraft(row, lines);
  }
}

function mapDraft(row: Row, lineRows: Row[]): QuoteDraft {
  const vehicleId = optionalText(row, "vehicle_id");
  const authorizedAt = optionalText(row, "authorized_at");
  return {
    id: text(row, "id"), businessId: text(row, "business_id"), conversationId: text(row, "conversation_id"), quoteRequestId: text(row, "quote_request_id"),
    ...(vehicleId === undefined ? {} : { vehicleId }), revision: numberValue(row, "revision"), status: text(row, "status") as QuoteDraftStatus,
    lines: lineRows.map(mapLine), productsSubtotal: { amountCents: numberValue(row, "products_subtotal_amount_cents"), currency: "BRL" },
    laborSubtotal: { amountCents: numberValue(row, "labor_subtotal_amount_cents"), currency: "BRL" }, total: { amountCents: numberValue(row, "total_amount_cents"), currency: "BRL" },
    createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"), ...(authorizedAt === undefined ? {} : { authorizedAt }),
  };
}
function mapLine(row: Row): QuoteDraftLine {
  const externalReference = optionalText(row, "external_reference");
  return { id: text(row, "id"), businessId: text(row, "business_id"), quoteDraftId: text(row, "quote_draft_id"), kind: text(row, "kind") as QuoteDraftLineKind, description: text(row, "description"), ...(externalReference === undefined ? {} : { externalReference }), quantity: numberValue(row, "quantity"), unit: text(row, "unit"), unitPriceCaptured: { amountCents: numberValue(row, "unit_price_captured_amount_cents"), currency: "BRL" }, subtotal: { amountCents: numberValue(row, "subtotal_amount_cents"), currency: "BRL" }, source: text(row, "source"), checkedAt: text(row, "checked_at") };
}
