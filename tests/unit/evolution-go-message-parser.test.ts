import assert from "node:assert/strict";
import test from "node:test";
import { parseEvolutionGoInboundText, parseEvolutionGoUnsupportedMessage, UNSUPPORTED_MESSAGE_CONTENT } from "../../src/channels/whatsapp/evolution-go-message-parser.js";

function payload(message: unknown, info: Record<string, unknown> = {}) {
  return {
    event: "Message",
    instanceName: "clinica-teste",
    data: {
      Info: {
        ID: "msg-ficticia-001",
        Type: "text",
        Sender: "5511999990000:12@s.whatsapp.net",
        Chat: "5511999990000@s.whatsapp.net",
        PushName: "Pessoa Fictícia",
        Timestamp: "2026-01-02T03:04:05Z",
        IsFromMe: false,
        IsGroup: false,
        ...info,
      },
      Message: message,
    },
    instanceToken: "segredo-ficticio-que-nao-deve-ser-retornado",
  };
}

test("parses a valid incoming text message and returns only normalized fields", () => {
  const result = parseEvolutionGoInboundText(payload({ conversation: "Olá, preciso de ajuda." }));

  assert.deepEqual(result, {
    instanceName: "clinica-teste",
    externalMessageId: "msg-ficticia-001",
    senderJid: "5511999990000@s.whatsapp.net",
    senderName: "Pessoa Fictícia",
    content: "Olá, preciso de ajuda.",
    occurredAt: "2026-01-02T03:04:05Z",
  });
});

test("parses extended text messages", () => {
  assert.equal(
    parseEvolutionGoInboundText(payload({ extendedTextMessage: { text: "Texto citado" } }))?.content,
    "Texto citado",
  );
});

test("the customer is the Chat, not the Sender that may carry a device", () => {
  assert.equal(parseEvolutionGoInboundText(payload({ conversation: "Olá" }))?.senderJid, "5511999990000@s.whatsapp.net");
  assert.equal(parseEvolutionGoUnsupportedMessage(payload({}, { Type: "audio" }))?.senderJid, "5511999990000@s.whatsapp.net");
});

test("uses Sender when Chat is missing or empty", () => {
  for (const chat of [undefined, "   "]) {
    const result = parseEvolutionGoInboundText(
      payload({ conversation: "Olá" }, { Chat: chat, Sender: "5511999990000@s.whatsapp.net" }),
    );
    assert.equal(result?.senderJid, "5511999990000@s.whatsapp.net");
  }
});

test("ignores messages sent by this instance", () => {
  assert.equal(parseEvolutionGoInboundText(payload({ conversation: "Eco" }, { IsFromMe: true })), null);
});

test("rejects messages when IsFromMe is absent", () => {
  const inbound = payload({ conversation: "Sem indicador de origem" });
  delete (inbound.data.Info as Record<string, unknown>).IsFromMe;
  assert.equal(parseEvolutionGoInboundText(inbound), null);
});

test("ignores reactions and other non-text message types", () => {
  assert.equal(
    parseEvolutionGoInboundText(
      payload({ conversation: "Texto que não deve ser aceito" }, { Type: "reaction" }),
    ),
    null,
  );
});

test("ignores group messages", () => {
  assert.equal(parseEvolutionGoInboundText(payload({ conversation: "Olá" }, { IsGroup: true })), null);
});

test("returns null for malformed payloads", () => {
  assert.equal(parseEvolutionGoInboundText(null), null);
  assert.equal(parseEvolutionGoInboundText({ event: "Message", instanceName: "x", data: [] }), null);
});

test("ignores empty or whitespace-only text", () => {
  assert.equal(parseEvolutionGoInboundText(payload({ conversation: "   " })), null);
  assert.equal(parseEvolutionGoInboundText(payload({ extendedTextMessage: { text: "\n " } })), null);
});

test("normalizes non-text customer messages without keeping provider content", () => {
  for (const Type of ["media", "audio", "image"]) {
    assert.equal(parseEvolutionGoInboundText(payload({ imageMessage: {} }, { Type })), null);
    assert.deepEqual(parseEvolutionGoUnsupportedMessage(payload({ imageMessage: { url: "x" } }, { Type })), {
      instanceName: "clinica-teste",
      externalMessageId: "msg-ficticia-001",
      senderJid: "5511999990000@s.whatsapp.net",
      senderName: "Pessoa Fictícia",
      occurredAt: "2026-01-02T03:04:05Z",
      content: UNSUPPORTED_MESSAGE_CONTENT,
    });
  }
});

test("does not answer reactions, own messages, groups or text events", () => {
  assert.equal(parseEvolutionGoUnsupportedMessage(payload({}, { Type: "reaction" })), null);
  assert.equal(parseEvolutionGoUnsupportedMessage(payload({}, { Type: "image", IsFromMe: true })), null);
  assert.equal(parseEvolutionGoUnsupportedMessage(payload({}, { Type: "image", IsGroup: true })), null);
  assert.equal(parseEvolutionGoUnsupportedMessage(payload({ conversation: "Oi" })), null);
  assert.equal(parseEvolutionGoUnsupportedMessage(payload({}, { Type: undefined })), null);
});
