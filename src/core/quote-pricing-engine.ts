import type { QuoteDraftLine } from "./quote-draft.js";
import type { Money } from "./domain/types.js";

export type QuotePricingResult = { productsSubtotal: Money; laborSubtotal: Money; total: Money; lines: QuoteDraftLine[] };

export class QuotePricingEngine {
  calculate(lines: readonly QuoteDraftLine[]): QuotePricingResult {
    let products = 0;
    let labor = 0;
    const checkedLines = lines.map((line) => {
      validateLine(line);
      const subtotal = line.quantity * line.unitPriceCaptured.amountCents;
      if (!Number.isSafeInteger(subtotal) || subtotal !== line.subtotal.amountCents) throw new Error("Quote line subtotal is not deterministic");
      if (line.kind === "PRODUCT") products += subtotal;
      else if (line.kind === "LABOR") labor += subtotal;
      else throw new Error("Quote line kind is invalid");
      return line;
    });
    if (!Number.isSafeInteger(products) || !Number.isSafeInteger(labor) || !Number.isSafeInteger(products + labor)) throw new Error("Quote total exceeds safe integer range");
    return { productsSubtotal: { amountCents: products, currency: "BRL" }, laborSubtotal: { amountCents: labor, currency: "BRL" }, total: { amountCents: products + labor, currency: "BRL" }, lines: checkedLines };
  }
}

function validateLine(line: QuoteDraftLine): void {
  if (line.unitPriceCaptured.currency !== "BRL" || line.subtotal.currency !== "BRL") throw new Error("Quote currency must be BRL");
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("Quote quantity is invalid");
  if (!Number.isSafeInteger(line.unitPriceCaptured.amountCents) || line.unitPriceCaptured.amountCents < 0) throw new Error("Quote unit price is invalid");
  if (!Number.isSafeInteger(line.subtotal.amountCents) || line.subtotal.amountCents < 0) throw new Error("Quote subtotal is invalid");
}
