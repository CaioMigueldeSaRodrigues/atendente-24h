import assert from "node:assert/strict";
import test from "node:test";
import { Intent } from "../../src/core/domain/enums.js";
import { resolveSafeReply } from "../../src/core/response-policy.js";

test("preserves proposedResponse for an unprotected intent", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.GENERAL_INFORMATION,
      proposedResponse: "Atendemos de segunda a sábado.",
      requiresHuman: false,
    }),
    "Atendemos de segunda a sábado.",
  );
});

test("uses the safe quote response instead of an unverified price", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.QUOTE_REQUEST,
      proposedResponse: "O valor é R$ 500.",
      requiresHuman: false,
    }),
    "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.",
  );
});

test("uses the safe appointment response instead of a false confirmation", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.APPOINTMENT_REQUEST,
      proposedResponse: "Seu horário está confirmado.",
      requiresHuman: false,
    }),
    "Solicitação de agendamento registrada. O horário ainda precisa ser confirmado pela equipe.",
  );
});

test("human handoff takes priority over quote response", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.QUOTE_REQUEST,
      proposedResponse: "O valor é R$ 500.",
      requiresHuman: true,
    }),
    "Vou encaminhar sua solicitação para a equipe responsável.",
  );
});

test("human handoff takes priority over appointment response", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.APPOINTMENT_REQUEST,
      proposedResponse: "Seu horário está confirmado.",
      requiresHuman: true,
    }),
    "Vou encaminhar sua solicitação para a equipe responsável.",
  );
});
