import type { QuoteRequest } from "./domain/entities.js";
import { canPresentAuthorizedPrice } from "./business-rules.js";

export function buildAuthorizedQuoteReply(quoteRequest: QuoteRequest): string {
  if (!canPresentAuthorizedPrice(quoteRequest)) {
    throw new Error("Authorized price cannot be presented");
  }

  const { amountCents } = quoteRequest.authorizedPrice!;
  const reais = Math.floor(amountCents / 100);
  const centavos = amountCents % 100;
  const formattedReais = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const formattedPrice = `R$ ${formattedReais},${String(centavos).padStart(2, "0")}`;

  return `O orçamento autorizado é de ${formattedPrice}. Deseja prosseguir?`;
}
