import type { QuoteDraft, QuoteDraftLine, QuoteDraftLineKind, QuoteDraftStatus } from "../../core/quote-draft.js";
import type { QuoteDraftRepository } from "../../core/repositories.js";
import { PostgresDatabase } from "./postgres-database.js";
import { assertDraftSave } from "../../core/quote-draft-write-policy.js";
import { QuoteDraftError } from "../../core/build-quote-draft.js";

type Row = Record<string, unknown>;
const text = (row: Row, key: string) => String(row[key]);
const optionalText = (row: Row, key: string) => row[key] == null ? undefined : String(row[key]);
const numberValue = (row: Row, key: string) => Number(row[key]);

export class PostgresQuoteDraftRepository implements QuoteDraftRepository {
  constructor(private readonly db: PostgresDatabase) {}
  async findById(businessId: string, id: string): Promise<QuoteDraft | null> { const result = await this.db.query("SELECT * FROM quote_drafts WHERE business_id=$1 AND id=$2", [businessId, id]); return result.rows[0] ? this.load(result.rows[0] as Row) : null; }
  async findLatestByQuoteRequest(businessId: string, quoteRequestId: string): Promise<QuoteDraft | null> { const result = await this.db.query("SELECT * FROM quote_drafts WHERE business_id=$1 AND quote_request_id=$2 ORDER BY revision DESC,id DESC LIMIT 1", [businessId, quoteRequestId]); return result.rows[0] ? this.load(result.rows[0] as Row) : null; }
  async save(entity: QuoteDraft): Promise<void> {
    await this.db.transaction(async (client) => {
      const existing = await this.findById(entity.businessId, entity.id);
      assertDraftSave(existing, entity);
      if (existing) {
        await client.query("UPDATE quote_drafts SET status=$1, updated_at=$2 WHERE business_id=$3 AND id=$4", [entity.status, entity.updatedAt, entity.businessId, entity.id]);
        return;
      }
      await client.query(`INSERT INTO quote_drafts(id,business_id,conversation_id,quote_request_id,vehicle_id,revision,status,products_subtotal_amount_cents,products_subtotal_currency,labor_subtotal_amount_cents,labor_subtotal_currency,total_amount_cents,total_currency,created_at,updated_at,authorized_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [entity.id, entity.businessId, entity.conversationId, entity.quoteRequestId, entity.vehicleId ?? null, entity.revision, entity.status, entity.productsSubtotal.amountCents, entity.productsSubtotal.currency, entity.laborSubtotal.amountCents, entity.laborSubtotal.currency, entity.total.amountCents, entity.total.currency, entity.createdAt, entity.updatedAt, entity.authorizedAt ?? null]);
      for (const line of entity.lines) await client.query(`INSERT INTO quote_draft_lines(id,business_id,quote_draft_id,kind,description,external_reference,quantity,unit,unit_price_captured_amount_cents,unit_price_captured_currency,subtotal_amount_cents,subtotal_currency,source,checked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [line.id, line.businessId, line.quoteDraftId, line.kind, line.description, line.externalReference ?? null, line.quantity, line.unit, line.unitPriceCaptured.amountCents, line.unitPriceCaptured.currency, line.subtotal.amountCents, line.subtotal.currency, line.source, line.checkedAt]);
    });
  }
  async approve(businessId: string, id: string, authorizedAt: string): Promise<void> {
    const result = await this.db.query("UPDATE quote_drafts SET status='APPROVED', authorized_at=$1, updated_at=$1 WHERE business_id=$2 AND id=$3 AND status='PENDING_APPROVAL'", [authorizedAt, businessId, id]);
    if (result.rowCount !== 1) throw new QuoteDraftError("DRAFT_NOT_APPROVABLE");
  }
  async markPublished(businessId: string, id: string, updatedAt: string): Promise<void> {
    const result = await this.db.query("UPDATE quote_drafts SET status='PUBLISHED', updated_at=$1 WHERE business_id=$2 AND id=$3 AND status='APPROVED'", [updatedAt, businessId, id]);
    if (result.rowCount !== 1) {
      const existing = await this.findById(businessId, id);
      if (existing?.status !== "PUBLISHED") throw new QuoteDraftError("DRAFT_NOT_APPROVABLE");
    }
  }
  private async load(row: Row): Promise<QuoteDraft> { const result = await this.db.query("SELECT * FROM quote_draft_lines WHERE business_id=$1 AND quote_draft_id=$2 ORDER BY id", [text(row, "business_id"), text(row, "id")]); return mapDraft(row, result.rows as Row[]); }
}
function mapDraft(row: Row, lineRows: Row[]): QuoteDraft { const vehicleId = optionalText(row, "vehicle_id"); const authorizedAt = optionalText(row, "authorized_at"); return { id: text(row, "id"), businessId: text(row, "business_id"), conversationId: text(row, "conversation_id"), quoteRequestId: text(row, "quote_request_id"), ...(vehicleId === undefined ? {} : { vehicleId }), revision: numberValue(row, "revision"), status: text(row, "status") as QuoteDraftStatus, lines: lineRows.map(mapLine), productsSubtotal: { amountCents: numberValue(row, "products_subtotal_amount_cents"), currency: "BRL" }, laborSubtotal: { amountCents: numberValue(row, "labor_subtotal_amount_cents"), currency: "BRL" }, total: { amountCents: numberValue(row, "total_amount_cents"), currency: "BRL" }, createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"), ...(authorizedAt === undefined ? {} : { authorizedAt }) }; }
function mapLine(row: Row): QuoteDraftLine { const externalReference = optionalText(row, "external_reference"); return { id: text(row, "id"), businessId: text(row, "business_id"), quoteDraftId: text(row, "quote_draft_id"), kind: text(row, "kind") as QuoteDraftLineKind, description: text(row, "description"), ...(externalReference === undefined ? {} : { externalReference }), quantity: numberValue(row, "quantity"), unit: text(row, "unit"), unitPriceCaptured: { amountCents: numberValue(row, "unit_price_captured_amount_cents"), currency: "BRL" }, subtotal: { amountCents: numberValue(row, "subtotal_amount_cents"), currency: "BRL" }, source: text(row, "source"), checkedAt: text(row, "checked_at") }; }
