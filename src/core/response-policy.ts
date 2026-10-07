import { Intent } from "./domain/enums.js";
import type { NextAction } from "./domain/types.js";

export function resolveSafeReply(input: {
  intent: Intent;
  proposedResponse: string;
  requiresHuman: boolean;
  suggestedNextAction: NextAction;
  missingData: readonly string[];
}): string {
  if (input.requiresHuman) {
    return "Vou encaminhar sua solicitação para a equipe responsável.";
  }

  if (
    input.intent === Intent.QUOTE_REQUEST &&
    input.suggestedNextAction.type === "REQUEST_INFORMATION" &&
    input.missingData.includes("requestedItem")
  ) {
    return "Qual serviço ou produto você deseja orçar? Pode também descrever o sintoma.";
  }

  if (input.intent === Intent.QUOTE_REQUEST) {
    return "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.";
  }

  if (input.intent === Intent.APPOINTMENT_REQUEST) {
    return "Solicitação de agendamento registrada. O horário ainda precisa ser confirmado pela equipe.";
  }

  return input.proposedResponse;
}
