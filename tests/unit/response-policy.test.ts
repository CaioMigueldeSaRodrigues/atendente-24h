import assert from "node:assert/strict";
import test from "node:test";
import { Intent } from "../../src/core/domain/enums.js";
import { resolveSafeReply } from "../../src/core/response-policy.js";

const noAction = { type: "NONE" as const, description: "Nenhuma ação" };
const requestInformation = {
  type: "REQUEST_INFORMATION" as const,
  description: "Solicitar dados faltantes",
};

test("preserves proposedResponse for an unprotected intent", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.GENERAL_INFORMATION,
      proposedResponse: "Atendemos de segunda a sábado.",
      requiresHuman: false,
      suggestedNextAction: noAction,
      missingData: [],
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
      suggestedNextAction: noAction,
      missingData: [],
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
      suggestedNextAction: noAction,
      missingData: [],
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
      suggestedNextAction: requestInformation,
      missingData: ["brand", "version"],
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
      suggestedNextAction: noAction,
      missingData: [],
    }),
    "Vou encaminhar sua solicitação para a equipe responsável.",
  );
});

test("requests only the first two known fields by priority", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.QUOTE_REQUEST,
      proposedResponse: "Resposta livre da IA.",
      requiresHuman: false,
      suggestedNextAction: requestInformation,
      missingData: ["brand", "version", "licensePlate", "mileage"],
    }),
    "Para preparar o orçamento, preciso de mais algumas informações: marca e versão. Pode me informar?",
  );
});

test("uses singular wording for one missing field", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.QUOTE_REQUEST,
      proposedResponse: "Resposta livre da IA.",
      requiresHuman: false,
      suggestedNextAction: requestInformation,
      missingData: ["version"],
    }),
    "Para preparar o orçamento, preciso de mais uma informação: versão. Pode me informar?",
  );
});

test("uses a safe generic message when no missing field is recognized", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.QUOTE_REQUEST,
      proposedResponse: "Resposta livre da IA.",
      requiresHuman: false,
      suggestedNextAction: requestInformation,
      missingData: ["unsupportedInternalField"],
    }),
    "Para preparar o orçamento, preciso de algumas informações adicionais. Pode me informar?",
  );
});

test("does not use a proposed price for quote information collection", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.QUOTE_REQUEST,
      proposedResponse: "O preço é R$ 500. Confirme seu interesse.",
      requiresHuman: false,
      suggestedNextAction: requestInformation,
      missingData: ["licensePlate"],
    }),
    "Para preparar o orçamento, preciso de mais uma informação: placa. Pode me informar?",
  );
});

test("human handoff takes priority over quote information collection", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.QUOTE_REQUEST,
      proposedResponse: "Resposta livre da IA.",
      requiresHuman: true,
      suggestedNextAction: requestInformation,
      missingData: ["brand", "version"],
    }),
    "Vou encaminhar sua solicitação para a equipe responsável.",
  );
});
