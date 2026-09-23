import { Intent } from "./domain/enums.js";
import type { NextAction } from "./domain/types.js";

const MISSING_DATA_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["brand", "marca"],
  ["model", "modelo"],
  ["year", "ano"],
  ["version", "versão"],
  ["licensePlate", "placa"],
  ["mileage", "quilometragem"],
  ["name", "nome"],
  ["primaryPhone", "telefone"],
  ["email", "e-mail"],
];

function buildQuoteInformationRequest(missingData: readonly string[]): string {
  const requestedLabels = MISSING_DATA_LABELS
    .filter(([field]) => missingData.includes(field))
    .slice(0, 2)
    .map(([, label]) => label);

  if (requestedLabels.length === 0) {
    return "Para preparar o orçamento, preciso de algumas informações adicionais. Pode me informar?";
  }

  const information = requestedLabels.join(" e ");
  if (requestedLabels.length === 1) {
    return `Para preparar o orçamento, preciso de mais uma informação: ${information}. Pode me informar?`;
  }

  return `Para preparar o orçamento, preciso de mais algumas informações: ${information}. Pode me informar?`;
}

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
    input.suggestedNextAction.type === "REQUEST_INFORMATION"
  ) {
    return buildQuoteInformationRequest(input.missingData);
  }

  if (input.intent === Intent.QUOTE_REQUEST) {
    return "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.";
  }

  if (input.intent === Intent.APPOINTMENT_REQUEST) {
    return "Solicitação de agendamento registrada. O horário ainda precisa ser confirmado pela equipe.";
  }

  return input.proposedResponse;
}
