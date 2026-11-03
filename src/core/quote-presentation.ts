import type { QuoteRequest } from "./domain/entities.js";
import { canPresentAuthorizedPrice } from "./business-rules.js";

const QUOTE_ITEM_MAX_CHARS = 120;

// Without an item from the interpreter the description is the customer's own text, which must not be echoed in a price message.
export function buildAuthorizedQuoteReply(quoteRequest: QuoteRequest, customerTexts: readonly string[] = []): string {
  if (!canPresentAuthorizedPrice(quoteRequest)) {
    throw new Error("Authorized price cannot be presented");
  }

  const { amountCents } = quoteRequest.authorizedPrice!;
  const reais = Math.floor(amountCents / 100);
  const centavos = amountCents % 100;
  const formattedReais = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const formattedPrice = `R$ ${formattedReais},${String(centavos).padStart(2, "0")}`;

  const item = customerTexts.includes(quoteRequest.requestDescription)
    ? "o seu pedido"
    : quoteRequest.requestDescription.replace(/\s+/g, " ").trim().slice(0, QUOTE_ITEM_MAX_CHARS);

  return `O orçamento autorizado para ${item} é de ${formattedPrice}. Deseja prosseguir?`;
}
