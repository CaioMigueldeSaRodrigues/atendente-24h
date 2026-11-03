import { CommercialOutcome, ConversationStatus, HandoffReason, OutboundDeliveryStatus, type Channel } from "./domain/enums.js";
import type { OutboundDelivery } from "./domain/entities.js";
import { OUTBOUND_DELIVERY_LEASE_MS, outboundDeliveryLeaseUntil } from "./outbound-delivery-policy.js";
import { STALE_HANDOFF_MS, STALE_TAKEN_HANDOFF_MS, resolveStaleHandoffs, type HumanHandoffServiceDependencies } from "./human-handoff-service.js";
import { openHandoff } from "./process-message.js";
import type { MessageRepository, OutboundDeliveryRepository } from "./repositories.js";

export const OUTBOUND_BACKOFF_MINUTES = [1, 5, 30, 120] as const;
export const OUTBOUND_MAX_ATTEMPTS = 6;
export const OUTBOUND_WORKER_INTERVAL_MS = 30_000;
export const OUTBOUND_WORKER_BATCH_SIZE = 50;
// A reply may still be on its way out of the webhook request that produced it.
export const PENDING_REPLY_GRACE_MS = 2 * 60 * 1000;
export const PENDING_REPLY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// A conversation without messages for this long is closed; the customer's next message opens a new one.
export const CONVERSATION_IDLE_CLOSE_MS = 24 * 60 * 60 * 1000;
// The customer may answer a price days later; the conversation stays open so the answer finds the quote.
export const RESPONDED_QUOTE_KEEP_OPEN_MS = 7 * 24 * 60 * 60 * 1000;

const LAST_ERROR_SEND_FAILED = "Channel sender failed";
const LAST_ERROR_UNDELIVERABLE = "Delivery has no message or recipient";

export type OutboundWorkerScope = { businessId: string; instanceName: string };

export type ExpiredChannelClaim = {
  businessId: string;
  instanceName: string;
  externalMessageId: string;
  receivedAt: string;
  conversationId: string;
  senderJid: string;
  content: string;
};

export type PendingChannelReply = {
  businessId: string;
  instanceName: string;
  externalMessageId: string;
  conversationId: string;
  senderJid: string;
  reply: string;
  attempts: number;
};

export type OutboundWorkerDependencies = {
  // One credential sends for one business and instance; rows of anyone else must stay out of reach.
  scope: OutboundWorkerScope;
  channel: Channel;
  deliveries: Pick<OutboundDeliveryRepository, "claimForSending" | "markDelivered" | "markFailed"> & {
    listDue(scope: OutboundWorkerScope, channel: Channel, now: string, pendingBefore: string, limit: number): Promise<OutboundDelivery[]>;
  };
  replies: {
    listDueReplies(scope: OutboundWorkerScope, now: string, receivedBefore: string, limit: number): Promise<PendingChannelReply[]>;
    failRepliesReceivedBefore(scope: OutboundWorkerScope, receivedBefore: string): Promise<void>;
    claimReplyRetry(reply: PendingChannelReply, nextRetryAt: string): Promise<boolean>;
    markReplyFailed(reply: PendingChannelReply): Promise<void>;
    markSent(input: { businessId: string; instanceName: string; externalMessageId: string; sentAt: string; providerMessageId?: string }): boolean | Promise<boolean>;
  };
  claims: {
    listExpiredClaims(scope: OutboundWorkerScope, now: string, limit: number): Promise<ExpiredChannelClaim[]>;
    // Null when another worker or a provider retry took the claim first.
    recover(claim: ExpiredChannelClaim): Promise<PendingChannelReply | null>;
  };
  conversations: {
    // Closes idle conversations of one business and channel, except those with a person or work still owed.
    closeIdle(businessId: string, channel: Channel, idleBefore: string, closedAt: string): Promise<number>;
  };
  messageRepository: Pick<MessageRepository, "listByConversation">;
  // The repositories behind the handoff queue; the worker supplies the clock, the ids and the sending.
  handoffs: Pick<HumanHandoffServiceDependencies, "humanHandoffRepository" | "conversationRepository" | "messageRepository" | "customerRepository" | "businessProfileRepository" | "businessRepository">;
  resolveRecipient: (businessId: string, conversationId: string) => Promise<string | null>;
  sender: { sendText(message: { recipientJid: string; content: string }): Promise<void | { providerMessageId: string }> };
  now: () => string;
  generateId: (prefix: string) => string;
  onError?: () => void;
  // Called at every failed send. It carries nothing about the message or the recipient.
  onSendFailed?: () => void;
  // Called when a final send failure opened a handoff, so the workshop can be told.
  onHandoffOpened?: (businessId: string) => void;
};

// ponytail: if the process dies between the provider accepting a message and its status being saved, the retry sends it again. Exactly-once needs provider-side idempotency keys.
export class OutboundWorker {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(private readonly dependencies: OutboundWorkerDependencies) {}

  start(): void {
    this.timer ??= setInterval(() => {
      this.running ??= this.runOnce()
        .catch(() => this.dependencies.onError?.())
        .finally(() => { this.running = undefined; });
    }, OUTBOUND_WORKER_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async runOnce(): Promise<void> {
    await this.recoverExpiredClaims();
    await this.resendDeliveries();
    await this.resendReplies();
    await this.closeIdleConversations();
    await this.returnStaleHandoffs();
  }

  // The recovered reply is stored as pending, so a failed send here is retried by resendReplies.
  private async recoverExpiredClaims(): Promise<void> {
    const { scope, claims, now } = this.dependencies;
    for (const claim of await claims.listExpiredClaims(scope, now(), OUTBOUND_WORKER_BATCH_SIZE)) {
      const reply = await claims.recover(claim);
      if (reply !== null) await this.sendReply(reply);
    }
  }

  private async resendDeliveries(): Promise<void> {
    const { scope, channel, deliveries, messageRepository, resolveRecipient, now, generateId } = this.dependencies;
    const startedAt = now();
    const due = await deliveries.listDue(scope, channel, startedAt, minusMilliseconds(startedAt, OUTBOUND_DELIVERY_LEASE_MS), OUTBOUND_WORKER_BATCH_SIZE);
    for (const delivery of due) {
      const claim = await deliveries.claimForSending(delivery.businessId, delivery.id, now(), outboundDeliveryLeaseUntil(now()), generateId("outbound-claim"));
      if (!claim.claimed) continue;
      const claimToken = claim.delivery.claimToken!;
      const message = (await messageRepository.listByConversation(delivery.businessId, delivery.conversationId))
        .find((candidate) => candidate.id === delivery.messageId);
      const recipientJid = delivery.recipientRef ?? await resolveRecipient(delivery.businessId, delivery.conversationId);
      if (message === undefined || !recipientJid) {
        await deliveries.markFailed(delivery.businessId, delivery.id, {
          status: OutboundDeliveryStatus.FAILED_FINAL,
          lastError: LAST_ERROR_UNDELIVERABLE,
          updatedAt: now(),
        }, claimToken);
        await this.handOffUndelivered(delivery.businessId, delivery.conversationId);
        continue;
      }

      let sendResult: void | { providerMessageId: string };
      try {
        sendResult = await this.send({ recipientJid, content: message.content });
      } catch {
        const exhausted = claim.delivery.attempts >= OUTBOUND_MAX_ATTEMPTS;
        await deliveries.markFailed(delivery.businessId, delivery.id, {
          status: exhausted ? OutboundDeliveryStatus.FAILED_FINAL : OutboundDeliveryStatus.FAILED_RETRYABLE,
          lastError: LAST_ERROR_SEND_FAILED,
          ...(exhausted ? {} : { nextAttemptAt: nextAttemptAt(now(), claim.delivery.attempts) }),
          updatedAt: now(),
        }, claimToken);
        if (exhausted) await this.handOffUndelivered(delivery.businessId, delivery.conversationId);
        continue;
      }
      await deliveries.markDelivered(delivery.businessId, delivery.id, now(), now(), claimToken, sendResult?.providerMessageId);
    }
  }

  private async resendReplies(): Promise<void> {
    const { scope, replies, now } = this.dependencies;
    const startedAt = now();
    await replies.failRepliesReceivedBefore(scope, minusMilliseconds(startedAt, PENDING_REPLY_MAX_AGE_MS));
    const due = await replies.listDueReplies(scope, startedAt, minusMilliseconds(startedAt, PENDING_REPLY_GRACE_MS), OUTBOUND_WORKER_BATCH_SIZE);
    for (const reply of due) {
      const attempt = reply.attempts + 1;
      // The stored next retry doubles as the lease: another worker skips this row until it passes.
      if (!(await replies.claimReplyRetry(reply, nextAttemptAt(now(), attempt)))) continue;
      const sent = await this.sendReply(reply);
      if (sent || attempt < OUTBOUND_MAX_ATTEMPTS) continue;
      await replies.markReplyFailed(reply);
      await this.handOffUndelivered(reply.businessId, reply.conversationId);
    }
  }

  private async closeIdleConversations(): Promise<void> {
    const { scope, channel, conversations, now } = this.dependencies;
    const at = now();
    await conversations.closeIdle(scope.businessId, channel, minusMilliseconds(at, CONVERSATION_IDLE_CLOSE_MS), at);
  }

  private async returnStaleHandoffs(): Promise<void> {
    const { scope, channel, handoffs, resolveRecipient, now, generateId } = this.dependencies;
    await resolveStaleHandoffs(scope.businessId, channel, minusMilliseconds(now(), STALE_HANDOFF_MS), minusMilliseconds(now(), STALE_TAKEN_HANDOFF_MS), {
      ...handoffs,
      sendToCustomer: async (conversation, content) => {
        const recipientJid = await resolveRecipient(conversation.businessId, conversation.id);
        if (!recipientJid) throw new Error(LAST_ERROR_UNDELIVERABLE);
        await this.send({ recipientJid, content });
      },
      now,
      generateId,
    });
  }

  private async sendReply(reply: PendingChannelReply): Promise<boolean> {
    const { replies, now } = this.dependencies;
    let sendResult: void | { providerMessageId: string };
    try {
      sendResult = await this.send({ recipientJid: reply.senderJid, content: reply.reply });
    } catch {
      return false;
    }
    await replies.markSent({
      businessId: reply.businessId,
      instanceName: reply.instanceName,
      externalMessageId: reply.externalMessageId,
      sentAt: now(),
      ...(sendResult ? { providerMessageId: sendResult.providerMessageId } : {}),
    });
    return true;
  }

  private async send(message: { recipientJid: string; content: string }): Promise<void | { providerMessageId: string }> {
    try {
      return await this.dependencies.sender.sendText(message);
    } catch (error) {
      this.dependencies.onSendFailed?.();
      throw error;
    }
  }

  // Nothing more will be tried, so the customer is owed a person.
  private async handOffUndelivered(businessId: string, conversationId: string): Promise<void> {
    const { handoffs, now, generateId, onHandoffOpened } = this.dependencies;
    const conversation = await handoffs.conversationRepository.findById(businessId, conversationId);
    if (conversation === null || !(await openHandoff(conversation, HandoffReason.INTEGRATION_FAILURE, { ...handoffs, now, generateId }))) return;
    await handoffs.conversationRepository.save({ ...conversation, status: ConversationStatus.WAITING_HUMAN, commercialOutcome: CommercialOutcome.HUMAN_HANDOFF });
    onHandoffOpened?.(businessId);
  }
}

function nextAttemptAt(now: string, attempt: number): string {
  const minutes = OUTBOUND_BACKOFF_MINUTES[Math.min(attempt, OUTBOUND_BACKOFF_MINUTES.length) - 1]!;
  return new Date(Date.parse(now) + minutes * 60 * 1000).toISOString();
}

function minusMilliseconds(now: string, milliseconds: number): string {
  return new Date(Date.parse(now) - milliseconds).toISOString();
}
