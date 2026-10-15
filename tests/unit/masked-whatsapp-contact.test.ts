import assert from "node:assert/strict";
import test from "node:test";
import { maskEvolutionGoContact } from "../../src/channels/whatsapp/masked-contact.js";

test("mascara o contato WhatsApp sem expor o JID", () => {
  assert.equal(maskEvolutionGoContact("5511999990000@s.whatsapp.net"), "WhatsApp •••• 0000");
  assert.equal(maskEvolutionGoContact("contacto-invalido"), "WhatsApp");
  assert.equal(maskEvolutionGoContact("123@s.whatsapp.net"), "WhatsApp");
});
