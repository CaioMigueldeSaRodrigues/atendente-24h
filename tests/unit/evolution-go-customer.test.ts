import assert from "node:assert/strict";
import test from "node:test";
import { ensureEvolutionGoCustomer, phoneFromJid } from "../../src/channels/whatsapp/evolution-go-customer.js";
import { Channel, ConversationStatus } from "../../src/core/domain/enums.js";
import type { Conversation } from "../../src/core/domain/entities.js";
import { InMemoryConversationRepository, InMemoryCustomerRepository } from "../../src/core/in-memory-repositories.js";

const at = "2026-01-01T12:00:00.000Z";
const conversation: Conversation = { id: "conversation-1", businessId: "business-a", channel: Channel.WHATSAPP, status: ConversationStatus.ACTIVE, startedAt: at, lastMessageAt: at };

test("the phone is the full number of a plain WhatsApp JID, and nothing else is a phone", () => {
  assert.equal(phoneFromJid("5511999990000@s.whatsapp.net"), "5511999990000");
  assert.equal(phoneFromJid(" 5511999990000@s.whatsapp.net "), "5511999990000");
  for (const jid of ["contacto-invalido", "123@s.whatsapp.net", "5511999990000:12@s.whatsapp.net", "98765432109876@lid", "5511999990000@g.us"]) {
    assert.equal(phoneFromJid(jid), undefined);
  }
});

async function ensure(contact: { senderJid: string; senderName?: string }, current = conversation) {
  const customerRepository = new InMemoryCustomerRepository();
  const conversationRepository = new InMemoryConversationRepository();
  await conversationRepository.save(current);
  await ensureEvolutionGoCustomer(current, contact, { customerRepository, conversationRepository, now: () => at, generateId: (prefix) => `${prefix}-1` });
  const saved = await conversationRepository.findById("business-a", "conversation-1");
  return { saved, customer: saved?.customerId === undefined ? null : await customerRepository.findById("business-a", saved.customerId) };
}

test("a conversation without a customer gets one with the phone from the JID and the profile name", async () => {
  const { saved, customer } = await ensure({ senderJid: "5511999990000@s.whatsapp.net", senderName: "  Maria da Silva " });
  assert.equal(saved?.customerId, "customer-1");
  assert.equal(customer?.primaryPhone, "5511999990000");
  assert.equal(customer?.name, "Maria da Silva");
});

test("the profile name never replaces a customer that already exists", async () => {
  const { saved } = await ensure({ senderJid: "5511999990000@s.whatsapp.net", senderName: "Apelido" }, { ...conversation, customerId: "customer-existing" });
  assert.equal(saved?.customerId, "customer-existing");
});

test("a JID without a phone and no profile name creates nobody", async () => {
  const { saved } = await ensure({ senderJid: "98765432109876@lid" });
  assert.equal(saved?.customerId, undefined);
  const named = await ensure({ senderJid: "98765432109876@lid", senderName: "Só o nome" });
  assert.equal(named.customer?.name, "Só o nome");
  assert.equal(named.customer?.primaryPhone, undefined);
});
