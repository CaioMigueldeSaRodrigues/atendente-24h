import assert from "node:assert/strict";
import test from "node:test";
import { Intent } from "../../src/core/domain/enums.js";
import { UNSAFE_REPLY_FALLBACK, resolveSafeReply as decideSafeReply } from "../../src/core/response-policy.js";

const resolveSafeReply = (input: Parameters<typeof decideSafeReply>[0]) => decideSafeReply(input).reply;

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

test("does not request optional vehicle fields suggested by the model", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.QUOTE_REQUEST,
      proposedResponse: "Resposta livre da IA.",
      requiresHuman: false,
      suggestedNextAction: requestInformation,
      missingData: ["brand", "version", "licensePlate", "mileage"],
    }),
    "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.",
  );
});

test("requests the commercial object when required by the domain", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.QUOTE_REQUEST,
      proposedResponse: "Resposta livre da IA.",
      requiresHuman: false,
      suggestedNextAction: requestInformation,
      missingData: ["requestedItem"],
    }),
    "Qual serviço ou produto você deseja orçar? Pode também descrever o sintoma.",
  );
});

test("does not create requirements from unknown missing fields", () => {
  assert.equal(
    resolveSafeReply({
      intent: Intent.QUOTE_REQUEST,
      proposedResponse: "Resposta livre da IA.",
      requiresHuman: false,
      suggestedNextAction: requestInformation,
      missingData: ["unsupportedInternalField"],
    }),
    "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.",
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
    "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.",
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

for (const unsafe of [
  "A troca sai por R$ 1.",
  "Fica em 200 reais.",
  "Damos 10% na revisão.",
  "Fazemos por dez por cento.",
  "Consigo um desconto para você.",
  "Hoje temos promoção de pneus.",
  "A primeira revisão é grátis.",
  "O prazo é curto.",
  "Fica pronto em 2 dias.",
  "Entregamos em duas horas.",
  "Fica pronto amanhã.",
  "Entregamos até hoje.",
  "custa 150,00",
  "O preço é 200",
  "R $ 150",
  "em 2h",
  "meia hora",
  "hoje mesmo",
  "na sexta",
  "semana que vem",
  "no mesmo dia",
  "Veja em https://golpe.example/oferta",
  "Acesse www.golpe.example",
  "Fale em wa.me/5511999990000",
  "x".repeat(1001),
  "Podemos atender na sexta às 15h.",
  "Atendemos seu carro na sexta.",
  "Atendemos em 2 horas.",
  "Abrimos hoje e ficou pronto amanhã.",
  "Custa uns 300",
  "Normalmente fica entre 200 e 300",
  "Coisa de 1 hora e está pronto",
  "Coisa de uma hora e está pronto",
  "Temos essa peça em estoque, pode vir sexta às 14h",
  "Pode vir amanhã às 8h que encaixamos",
  "A garantia é de 90 dias",
  "Temos vaga amanhã.",
  "Garantimos o serviço.",
  "Pode vir amanhã.",
  "Fazemos troca de óleo 5W30 em Corolla 2020.",
  "Nosso telefone é (92) 3333-4444.",
  "Chame no 92 99999-0000.",
  "24 horas",
  "até 2 horas",
  "até 18 horas fica pronto",
  "Fica pronto das 8 às 18 horas, pode trazer.",
  "Abrimos às 8h e a revisão sai uns 300.",
]) {
  test(`replaces an unsafe free reply: ${unsafe.slice(0, 40)}`, () => {
    assert.equal(resolveSafeReply({
      intent: Intent.GENERAL_INFORMATION,
      proposedResponse: unsafe,
      requiresHuman: false,
      suggestedNextAction: noAction,
      missingData: [],
    }), UNSAFE_REPLY_FALLBACK);
  });
}

test("keeps ordinary replies within the limit", () => {
  for (const safe of [
    "há dois dias",
    "Faz uma semana",
    "hoje ou amanhã?",
    "das 8 às 18 horas",
    "até 18 horas",
    "Não trabalhamos com desconto",
    "Entendi.Me diga",
    "das 8h às 18h",
    "De segunda a sexta, das 8h às 18h.",
    "Você notou o barulho há meia hora?",
    "Faz 3 meses que o carro está assim?",
    "Atendemos 24 horas por dia.",
    "Prefere hoje ou amanhã?",
    "Olá! Como posso ajudar hoje?", "Isso precisa de um diagnóstico da equipe.", "É sempre um mesmo barulho?", "Bom dia, em que dia você passou aqui?", "y".repeat(1000),
    "Funcionamos de segunda a sexta, das 8h às 18h.",
    "Atendemos até 18 horas.",
    "Abrimos no sábado das 8h às 12h.",
    "Estamos abertos até as 18h.",
    "Nosso horário é das 08:00 às 18:00, de segunda a sexta.",
    "Fechamos às 17:30. No sábado abrimos até 12 horas.",
  ]) {
    assert.equal(resolveSafeReply({
      intent: Intent.GENERAL_INFORMATION,
      proposedResponse: safe,
      requiresHuman: false,
      suggestedNextAction: noAction,
      missingData: [],
    }), safe);
  }
});

test("numbers the workshop registered pass, however the phone is written, and nothing else does", () => {
  const businessFacts = {
    address: "Av. Brasil, 1500 - sala 3",
    phone: "(92) 3333-4444",
    openingHours: { segunda: "08:00-18:00", domingo: "fechado" },
    services: ["Alinhamento 3D"],
    paymentMethods: ["Cartão em 12x"],
    notes: "Estacionamento para 8 carros",
  };
  const reply = (proposedResponse: string) => resolveSafeReply({ intent: Intent.GENERAL_INFORMATION, proposedResponse, requiresHuman: false, suggestedNextAction: noAction, missingData: [], businessFacts });

  for (const safe of [
    "Estamos na Av. Brasil, 1500 - sala 3.",
    "Nosso telefone é (92) 3333-4444.",
    "Ligue 92 3333-4444.",
    "9233334444",
    "Segunda: 08:00-18:00.",
    "Fazemos alinhamento 3D.",
    "Parcelamos em 12x.",
  ]) assert.equal(reply(safe), safe);

  for (const unsafe of ["Custa uns 300", "Ligue 92 3333-4445.", "Fica entre 1500 e 1600", "Rua 7"]) assert.equal(reply(unsafe), UNSAFE_REPLY_FALLBACK);
});

test("reports whether the reply was blocked", () => {
  const input = { intent: Intent.GENERAL_INFORMATION, requiresHuman: false, suggestedNextAction: noAction, missingData: [] };
  assert.deepEqual(decideSafeReply({ ...input, proposedResponse: "Custa 200 reais." }), { reply: UNSAFE_REPLY_FALLBACK, blocked: true });
  assert.deepEqual(decideSafeReply({ ...input, proposedResponse: "Olá!" }), { reply: "Olá!", blocked: false });
  assert.equal(decideSafeReply({ ...input, requiresHuman: true, proposedResponse: "Custa 200 reais." }).blocked, false);
});
