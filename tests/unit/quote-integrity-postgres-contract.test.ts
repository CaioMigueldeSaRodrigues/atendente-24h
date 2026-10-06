import test from "node:test";
import assert from "node:assert/strict";
import type { PostgresDatabase } from "../../src/infrastructure/postgres/postgres-database.js";
import { PostgresQuoteDraftRepository } from "../../src/infrastructure/postgres/postgres-quote-draft-repository.js";
import { QuoteDraftError } from "../../src/core/build-quote-draft.js";
import type { QuoteDraft } from "../../src/core/quote-draft.js";

test("PostgreSQL repository rejects an approved snapshot overwrite before issuing UPDATE", async () => {
  const statements: string[] = [];
  const stored = {
    id: "draft-pg", business_id: "business-pg", conversation_id: "conversation-pg", quote_request_id: "quote-pg", vehicle_id: null,
    revision: 1, status: "APPROVED", products_subtotal_amount_cents: "4800", products_subtotal_currency: "BRL",
    labor_subtotal_amount_cents: "0", labor_subtotal_currency: "BRL", total_amount_cents: "4800", total_currency: "BRL",
    created_at: "created", updated_at: "approved", authorized_at: "approved",
  };
  const query = async (sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    statements.push(sql);
    if (sql.startsWith("SELECT * FROM quote_drafts")) return { rows: [stored], rowCount: 1 };
    if (sql.startsWith("SELECT * FROM quote_draft_lines")) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected write: ${sql}`);
  };
  const database = { query, transaction: async <T>(operation: (client: { query: typeof query }) => Promise<T>) => operation({ query }) } as unknown as PostgresDatabase;
  const repository = new PostgresQuoteDraftRepository(database);
  const incoming: QuoteDraft = {
    id: "draft-pg", businessId: "business-pg", conversationId: "conversation-pg", quoteRequestId: "quote-pg", revision: 1,
    status: "APPROVED" as QuoteDraft["status"], lines: [], productsSubtotal: { amountCents: 4800, currency: "BRL" },
    laborSubtotal: { amountCents: 0, currency: "BRL" }, total: { amountCents: 1, currency: "BRL" },
    createdAt: "created", updatedAt: "approved", authorizedAt: "approved",
  };
  await assert.rejects(repository.save(incoming), (error: unknown) => error instanceof QuoteDraftError && error.code === "DRAFT_IMMUTABLE");
  assert.equal(statements.some((statement) => statement.startsWith("UPDATE")), false);
});

test("PostgreSQL publication transition requires APPROVED status", async () => {
  const statements: string[] = [];
  const database = { query: async (sql: string) => { statements.push(sql); return { rows: [], rowCount: 1 }; } } as unknown as PostgresDatabase;
  await new PostgresQuoteDraftRepository(database).markPublished("business-pg", "draft-pg", "published");
  assert.match(statements[0] ?? "", /WHERE business_id=\$2 AND id=\$3 AND status='APPROVED'/);
});
