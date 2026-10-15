import type { Appointment, QuoteRequest } from "./domain/entities.js";
import { AppointmentStatus, Intent, QuoteRequestStatus } from "./domain/enums.js";

export function canPresentAuthorizedPrice(quoteRequest: QuoteRequest): boolean {
  return (
    quoteRequest.status === QuoteRequestStatus.RESPONDED &&
    quoteRequest.authorizedPrice !== undefined
  );
}

export function isAppointmentConfirmed(appointment: Appointment): boolean {
  return (
    appointment.status === AppointmentStatus.CONFIRMED &&
    appointment.confirmedStartAt !== undefined &&
    appointment.confirmedStartAt !== ""
  );
}

export function requiresExplicitHumanHandoff(intent: Intent): boolean {
  return intent === Intent.HUMAN_REQUEST;
}

export function requiresTechnicalDiagnosisHandoff(content: string): boolean {
  const normalized = normalizeForRule(content);
  const asksForDiagnosis = /\b(?:o que e|o que pode ser|qual (?:e o |o )?problema|qual a causa|por que isso acontece|qual seria o diagnostico|consegue me dizer o que e)\b/.test(normalized);
  const hasAutomotiveContext = /\b(?:carro|veiculo|barulho|ruido|freio|frear|motor|embreagem|pneu|direcao|bateria|oleo|pastilha|disco|sintoma)\b/.test(normalized);
  return asksForDiagnosis && hasAutomotiveContext;
}

function normalizeForRule(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
