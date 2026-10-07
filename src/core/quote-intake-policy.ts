import type { AIInterpretation } from "./domain/types.js";

// O modelo interpreta o objeto comercial; não define exigências da oficina.
// Sem política explícita, dados cadastrais/veiculares não bloqueiam o registro.
export function getQuoteIntakeMissingData(
  interpretation: Pick<AIInterpretation, "requestedItem" | "symptomDescription">,
): string[] {
  const hasCommercialObject = [
    interpretation.requestedItem,
    interpretation.symptomDescription,
  ].some((value) => value !== undefined && value.trim().length > 0);
  return hasCommercialObject ? [] : ["requestedItem"];
}
