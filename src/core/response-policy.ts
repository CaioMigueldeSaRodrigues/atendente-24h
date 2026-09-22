import { Intent } from "./domain/enums.js";

export function resolveSafeReply(input: {
  intent: Intent;
  proposedResponse: string;
  requiresHuman: boolean;
}): string {
  if (input.requiresHuman) {
    return "Vou encaminhar sua solicitação para a equipe responsável.";
  }

  if (input.intent === Intent.QUOTE_REQUEST) {
    return "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.";
  }

  if (input.intent === Intent.APPOINTMENT_REQUEST) {
    return "Solicitação de agendamento registrada. O horário ainda precisa ser confirmado pela equipe.";
  }

  return input.proposedResponse;
}
