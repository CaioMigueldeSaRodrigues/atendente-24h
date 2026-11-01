import type { Conversation, Customer } from "../../core/domain/entities.js";
import type { ConversationRepository, CustomerRepository } from "../../core/repositories.js";

const MAX_NAME_CHARS = 100;

// The phone is the digits of a plain WhatsApp JID; any other JID (such as a hidden-number id) has none.
export function phoneFromJid(senderJid: string): string | undefined {
  return /^([0-9]{8,15})@s\.whatsapp\.net$/.exec(senderJid.trim())?.[1];
}

// A conversation without a customer gets one from what WhatsApp already tells us. The profile name only seeds
// a new customer: whatever the person says about themselves later is applied over it.
export async function ensureEvolutionGoCustomer(
  conversation: Conversation,
  contact: { senderJid: string; senderName?: string },
  dependencies: {
    customerRepository: Pick<CustomerRepository, "save">;
    conversationRepository: Pick<ConversationRepository, "save">;
    now: () => string;
    generateId: (prefix: string) => string;
  },
): Promise<void> {
  if (conversation.customerId !== undefined) return;
  const primaryPhone = phoneFromJid(contact.senderJid);
  const name = contact.senderName?.trim().slice(0, MAX_NAME_CHARS);
  if (primaryPhone === undefined && !name) return;
  const now = dependencies.now();
  const customer: Customer = {
    id: dependencies.generateId("customer"),
    businessId: conversation.businessId,
    ...(name ? { name } : {}),
    ...(primaryPhone === undefined ? {} : { primaryPhone }),
    createdAt: now,
    updatedAt: now,
  };
  await dependencies.customerRepository.save(customer);
  await dependencies.conversationRepository.save({ ...conversation, customerId: customer.id });
}
