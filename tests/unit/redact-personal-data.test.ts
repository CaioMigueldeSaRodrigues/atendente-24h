import assert from "node:assert/strict";
import test from "node:test";
import { isRedactionMarker, redactPersonalData } from "../../src/core/redact-personal-data.js";
import { SenderType } from "../../src/core/domain/enums.js";
import { Channel } from "../../src/core/domain/enums.js";
import { buildInterpreterContext, LLM_HISTORY_WINDOW } from "../../src/core/message-interpreter.js";

for (const [text, marker] of [
  ["Meu CPF é 123.456.789-09.", "[CPF]"],
  ["cpf 12345678909", "[CPF]"],
  ["CNPJ 12.345.678/0001-95", "[CNPJ]"],
  ["cnpj 12345678000195", "[CNPJ]"],
  ["mande para joao.silva+nf@oficina.com.br", "[EMAIL]"],
  ["Cartão 4111 1111 1111 1111 validade 12/30", "[CARTAO]"],
  ["cartao 4111-1111-1111-1111", "[CARTAO]"],
  ["Ligue +55 (92) 99999-0000", "[TELEFONE]"],
  ["zap 92 99999-0000", "[TELEFONE]"],
  ["fone (11) 3333-4444", "[TELEFONE]"],
  ["meu número é 99999-0000", "[TELEFONE]"],
  ["telefone 3333-4444", "[TELEFONE]"],
] as const) {
  test(`redacts ${marker} in "${text}"`, () => {
    const redacted = redactPersonalData(text);
    assert.ok(redacted.includes(marker), redacted);
    assert.equal(/\d{4}/.test(redacted.replace("12/30", "")), false, redacted);
  });
}

test("keeps the vehicle and commercial data the interpreter needs", () => {
  for (const text of [
    "Corolla 2020 XEi com 120000 km",
    "Modelos 2019 2020 e 2021",
    "Peça 0986B02486",
    "placa ABC1D23, chassi 9BWZZZ377VT004251",
    "paguei 1500 em 20/10/2026",
    "2018-2020",
    "120000 2018",
    "95000 2018",
    "1234-5678",
    "1500-2000",
    "ABC-1234-2018",
    "código da peça 1234-5678",
  ]) assert.equal(redactPersonalData(text), text);
});

test("recognizes only exact markers", () => {
  for (const marker of ["[EMAIL]", "[TELEFONE]", "[CPF]", "[CNPJ]", "[CARTAO]", " [EMAIL] "]) assert.equal(isRedactionMarker(marker), true, marker);
  for (const value of ["João", "[OUTRO]", 2020, undefined]) assert.equal(isRedactionMarker(value), false);
});

test("interpreter context has no tenant ids, keeps a 20 message window and is redacted", () => {
  const history = Array.from({ length: 25 }, (_, index) => ({
    id: `message-${index}`,
    businessId: "business-a",
    conversationId: "conversation-a",
    senderType: SenderType.CUSTOMER,
    channel: Channel.WEB,
    content: `mensagem ${index} joao@oficina.com`,
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  const context = buildInterpreterContext({ businessId: "business-a", conversationId: "conversation-a", content: "cpf 123.456.789-09", history });
  assert.deepEqual(Object.keys(context).sort(), ["content", "history"]);
  assert.equal(context.content, "cpf [CPF]");
  assert.equal(context.history.length, LLM_HISTORY_WINDOW);
  assert.equal(context.history[0]!.content, "mensagem 5 [EMAIL]");
  assert.equal(JSON.stringify(context).includes("business-a"), false);
  assert.equal(JSON.stringify(context).includes("conversation-a"), false);
});
