import { hasOpeningHours, isOpenAt, type BusinessProfileRepository } from "./business-profile.js";
import type { Conversation, HumanHandoff, Message } from "./domain/entities.js";
import { ConversationStatus, HandoffStatus, OPEN_HANDOFF_STATUSES, SenderType } from "./domain/enums.js";
import { MAX_MESSAGE_CHARS, businessTimezone } from "./process-message.js";
import type { AutomotiveBusinessRepository, ConversationRepository, CustomerRepository, HumanHandoffRepository, MessageRepository } from "./repositories.js";

const QUEUE_HISTORY_MESSAGES = 30;
const OPERATOR = "operador";
// A handoff nobody took, and nobody answered, for this long goes back to the assistant.
export const STALE_HANDOFF_MS = 12 * 60 * 60 * 1000;
// A handoff a person took and stopped answering for this long goes back too: the customer is not left waiting on nobody.
export const STALE_TAKEN_HANDOFF_MS = 24 * 60 * 60 * 1000;
export const STALE_HANDOFF_REPLY = "Peço desculpas pela demora: ainda não conseguimos atender o seu pedido por aqui. Pode me contar de novo o que você precisa? Assim continuo te ajudando.";

export type HumanHandoffErrorCode = "HANDOFF_NOT_FOUND" | "HANDOFF_NOT_OPEN" | "INVALID_CONTENT" | "SEND_FAILED";

export class HumanHandoffError extends Error {
  constructor(readonly code: HumanHandoffErrorCode) {
    super(code);
  }
}

export type HumanHandoffServiceDependencies = {
  humanHandoffRepository: HumanHandoffRepository;
  conversationRepository: Pick<ConversationRepository, "findById" | "save">;
  messageRepository: Pick<MessageRepository, "save" | "listByConversation">;
  customerRepository: Pick<CustomerRepository, "findById">;
  // Absent or without hours: the workshop counts as always open.
  businessProfileRepository?: Pick<BusinessProfileRepository, "findByBusinessId">;
  businessRepository?: Pick<AutomotiveBusinessRepository, "findById">;
  // Delivers the text to the customer through the conversation's channel; throws when it cannot.
  sendToCustomer: (conversation: Conversation, content: string) => Promise<void>;
  now: () => string;
  generateId: (prefix: string) => string;
};

export type HandoffQueueItem = {
  id: string;
  conversationId: string;
  status: HandoffStatus;
  reason: HumanHandoff["reason"];
  summary: string;
  assignedTo?: string;
  requestedAt: string;
  customer: { name?: string; phone?: string };
  messages: Array<Pick<Message, "id" | "senderType" | "content" | "createdAt">>;
};

export async function listOpenHandoffs(businessId: string, dependencies: HumanHandoffServiceDependencies): Promise<HandoffQueueItem[]> {
  const items: HandoffQueueItem[] = [];
  for (const handoff of await dependencies.humanHandoffRepository.listOpen(businessId)) {
    const conversation = await dependencies.conversationRepository.findById(businessId, handoff.conversationId);
    const customer = conversation?.customerId === undefined ? null : await dependencies.customerRepository.findById(businessId, conversation.customerId);
    const messages = await dependencies.messageRepository.listByConversation(businessId, handoff.conversationId);
    items.push({
      id: handoff.id,
      conversationId: handoff.conversationId,
      status: handoff.status,
      reason: handoff.reason,
      summary: handoff.summary,
      ...(handoff.assignedTo === undefined ? {} : { assignedTo: handoff.assignedTo }),
      requestedAt: handoff.requestedAt,
      customer: {
        ...(customer?.name === undefined ? {} : { name: customer.name }),
        ...(customer?.primaryPhone === undefined ? {} : { phone: customer.primaryPhone }),
      },
      messages: messages.slice(-QUEUE_HISTORY_MESSAGES).map(({ id, senderType, content, createdAt }) => ({ id, senderType, content, createdAt })),
    });
  }
  return items;
}

export async function assignHandoff(businessId: string, handoffId: string, dependencies: HumanHandoffServiceDependencies): Promise<HumanHandoff> {
  const handoff = await requireOpenHandoff(businessId, handoffId, dependencies);
  if (handoff.status === HandoffStatus.ACCEPTED) return handoff;
  const now = dependencies.now();
  const accepted: HumanHandoff = { ...handoff, status: HandoffStatus.ACCEPTED, assignedTo: OPERATOR, acceptedAt: now, updatedAt: now };
  await dependencies.humanHandoffRepository.save(accepted);
  return accepted;
}

// The text goes out first and is stored after: when the send fails nothing is written, not even the assignment, and the operator tries again.
export async function replyToHandoff(businessId: string, handoffId: string, content: unknown, dependencies: HumanHandoffServiceDependencies): Promise<Message> {
  if (typeof content !== "string" || content.trim() === "" || content.length > MAX_MESSAGE_CHARS) throw new HumanHandoffError("INVALID_CONTENT");
  const handoff = await requireOpenHandoff(businessId, handoffId, dependencies);
  const conversation = await requireConversation(businessId, handoff.conversationId, dependencies);
  try {
    await dependencies.sendToCustomer(conversation, content.trim());
  } catch {
    throw new HumanHandoffError("SEND_FAILED");
  }
  await assignHandoff(businessId, handoffId, dependencies);
  const now = dependencies.now();
  const message: Message = {
    id: dependencies.generateId("message"),
    businessId,
    conversationId: conversation.id,
    senderType: SenderType.HUMAN_AGENT,
    channel: conversation.channel,
    content: content.trim(),
    createdAt: now,
  };
  await dependencies.messageRepository.save(message);
  await dependencies.conversationRepository.save({ ...conversation, lastMessageAt: now });
  return message;
}

// Every handoff nobody took (no assign, hence no reply) before `staleBefore`, and every taken one whose person went quiet before `takenStaleBefore`,
// is resolved and its conversation goes back to the bot, which tells the customer once to repeat what they need.
// Outside business hours nothing happens: the handoff waits for the opening, so the apology is not sent at night.
// ponytail: the handoff is resolved before the text is sent, so a failed send is not retried; the customer's next message still reaches the assistant.
export async function resolveStaleHandoffs(
  businessId: string,
  channel: Conversation["channel"],
  staleBefore: string,
  takenStaleBefore: string,
  dependencies: HumanHandoffServiceDependencies,
): Promise<number> {
  if (!(await isWithinBusinessHours(businessId, dependencies))) return 0;
  const open = await dependencies.humanHandoffRepository.listOpen(businessId);
  const taken = new Set(open.filter(({ status }) => status === HandoffStatus.ACCEPTED).map(({ conversationId }) => conversationId));
  let resolved = 0;
  for (const handoff of open) {
    const isTaken = handoff.status === HandoffStatus.ACCEPTED;
    if (!isTaken && (taken.has(handoff.conversationId) || handoff.requestedAt >= staleBefore)) continue;
    const conversation = await dependencies.conversationRepository.findById(businessId, handoff.conversationId);
    if (conversation === null || conversation.channel !== channel) continue;
    if (isTaken && (await lastPersonActivity(handoff, dependencies)) >= takenStaleBefore) continue;
    await resolveHandoff(businessId, handoff.id, dependencies);
    resolved += 1;
    try {
      await dependencies.sendToCustomer(conversation, STALE_HANDOFF_REPLY);
    } catch {
      continue;
    }
    await dependencies.messageRepository.save({
      id: dependencies.generateId("message"),
      businessId,
      conversationId: conversation.id,
      senderType: SenderType.ASSISTANT,
      channel: conversation.channel,
      content: STALE_HANDOFF_REPLY,
      createdAt: dependencies.now(),
    });
  }
  return resolved;
}

async function isWithinBusinessHours(businessId: string, dependencies: HumanHandoffServiceDependencies): Promise<boolean> {
  const profile = await dependencies.businessProfileRepository?.findByBusinessId(businessId);
  if (!profile || !hasOpeningHours(profile)) return true;
  return isOpenAt(profile, dependencies.now(), await businessTimezone(businessId, dependencies));
}

async function lastPersonActivity(handoff: HumanHandoff, dependencies: HumanHandoffServiceDependencies): Promise<string> {
  const messages = await dependencies.messageRepository.listByConversation(handoff.businessId, handoff.conversationId);
  const replies = messages.filter(({ senderType }) => senderType === SenderType.HUMAN_AGENT).map(({ createdAt }) => createdAt);
  return [handoff.acceptedAt ?? handoff.requestedAt, ...replies].sort().at(-1)!;
}

// Gives the conversation back to the bot: every open handoff of it closes, and the idle clock restarts.
export async function resolveHandoff(businessId: string, handoffId: string, dependencies: HumanHandoffServiceDependencies): Promise<HumanHandoff> {
  const handoff = await requireOpenHandoff(businessId, handoffId, dependencies);
  const conversation = await requireConversation(businessId, handoff.conversationId, dependencies);
  const now = dependencies.now();
  let resolved = handoff;
  for (const open of await dependencies.humanHandoffRepository.listOpen(businessId)) {
    if (open.conversationId !== conversation.id) continue;
    const closed: HumanHandoff = { ...open, status: HandoffStatus.RESOLVED, resolvedAt: now, updatedAt: now };
    await dependencies.humanHandoffRepository.save(closed);
    if (open.id === handoff.id) resolved = closed;
  }
  await dependencies.conversationRepository.save({
    ...conversation,
    status: conversation.status === ConversationStatus.WAITING_HUMAN ? ConversationStatus.ACTIVE : conversation.status,
    lastMessageAt: now,
  });
  return resolved;
}

async function requireOpenHandoff(businessId: string, handoffId: string, dependencies: HumanHandoffServiceDependencies): Promise<HumanHandoff> {
  const handoff = await dependencies.humanHandoffRepository.findById(businessId, handoffId);
  if (handoff === null) throw new HumanHandoffError("HANDOFF_NOT_FOUND");
  if (!OPEN_HANDOFF_STATUSES.includes(handoff.status)) throw new HumanHandoffError("HANDOFF_NOT_OPEN");
  return handoff;
}

async function requireConversation(businessId: string, conversationId: string, dependencies: HumanHandoffServiceDependencies): Promise<Conversation> {
  const conversation = await dependencies.conversationRepository.findById(businessId, conversationId);
  if (conversation === null) throw new HumanHandoffError("HANDOFF_NOT_FOUND");
  return conversation;
}
