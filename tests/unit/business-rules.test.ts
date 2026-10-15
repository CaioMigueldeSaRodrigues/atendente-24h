import assert from "node:assert/strict";
import test from "node:test";
import {
  AppointmentStatus,
  Intent,
  QuoteRequestStatus,
} from "../../src/core/domain/enums.js";
import type { Appointment, QuoteRequest } from "../../src/core/domain/entities.js";
import {
  canPresentAuthorizedPrice,
  isAppointmentConfirmed,
  requiresExplicitHumanHandoff,
  requiresTechnicalDiagnosisHandoff,
} from "../../src/core/business-rules.js";

const quoteRequest = (overrides: Partial<QuoteRequest>): QuoteRequest => ({
  id: "quote-1",
  businessId: "business-1",
  opportunityId: "opportunity-1",
  conversationId: "conversation-1",
  requestDescription: "Alinhamento",
  status: QuoteRequestStatus.REQUESTED,
  requestedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const appointment = (overrides: Partial<Appointment>): Appointment => ({
  id: "appointment-1",
  businessId: "business-1",
  conversationId: "conversation-1",
  status: AppointmentStatus.REQUESTED,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

test("can present price for a responded quote with authorized price", () => {
  const quote = quoteRequest({
    status: QuoteRequestStatus.RESPONDED,
    authorizedPrice: { amountCents: 12500, currency: "BRL" },
  });

  assert.equal(canPresentAuthorizedPrice(quote), true);
});

test("cannot present price for a responded quote without authorized price", () => {
  const quote = quoteRequest({ status: QuoteRequestStatus.RESPONDED });

  assert.equal(canPresentAuthorizedPrice(quote), false);
});

test("cannot present authorized price while quote is waiting for business", () => {
  const quote = quoteRequest({
    status: QuoteRequestStatus.WAITING_BUSINESS,
    authorizedPrice: { amountCents: 12500, currency: "BRL" },
  });

  assert.equal(canPresentAuthorizedPrice(quote), false);
});

test("recognizes a confirmed appointment with confirmed start time", () => {
  const value = appointment({
    status: AppointmentStatus.CONFIRMED,
    confirmedStartAt: "2026-01-02T10:00:00.000Z",
  });

  assert.equal(isAppointmentConfirmed(value), true);
});

test("does not recognize a confirmed appointment without confirmed start time", () => {
  const value = appointment({ status: AppointmentStatus.CONFIRMED });

  assert.equal(isAppointmentConfirmed(value), false);
});

test("requested date and time do not confirm an appointment", () => {
  const value = appointment({
    status: AppointmentStatus.REQUESTED,
    requestedDate: "2026-01-02",
    requestedTime: "10:00",
  });

  assert.equal(isAppointmentConfirmed(value), false);
});

test("requires explicit handoff for HUMAN_REQUEST", () => {
  assert.equal(requiresExplicitHumanHandoff(Intent.HUMAN_REQUEST), true);
});

test("does not require explicit handoff for QUOTE_REQUEST", () => {
  assert.equal(requiresExplicitHumanHandoff(Intent.QUOTE_REQUEST), false);
});

test("does not require explicit handoff for APPOINTMENT_REQUEST", () => {
  assert.equal(requiresExplicitHumanHandoff(Intent.APPOINTMENT_REQUEST), false);
});

test("allows symptom collection when the customer only reports a symptom", () => {
  assert.equal(
    requiresTechnicalDiagnosisHandoff("Meu carro faz um barulho ao frear."),
    false,
  );
});

for (const content of [
  "Meu carro faz um barulho ao frear. O que é?",
  "Qual é o problema quando freio?",
  "O que pode ser esse ruído?",
  "Você consegue me dizer qual seria o diagnóstico do barulho ao frear?",
]) {
  test(`requires human review for explicit technical diagnosis: ${content}`, () => {
    assert.equal(requiresTechnicalDiagnosisHandoff(content), true);
  });
}

test("does not convert unrelated intents into diagnostic handoff", () => {
  assert.equal(
    requiresTechnicalDiagnosisHandoff("Qual é o problema com meu agendamento?"),
    false,
  );
});

test("does not rely on the model intent for an explicit automotive diagnosis request", () => {
  assert.equal(
    requiresTechnicalDiagnosisHandoff("Meu carro faz um barulho ao frear. O que é?"),
    true,
  );
});
