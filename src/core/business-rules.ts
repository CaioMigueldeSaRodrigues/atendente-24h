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
