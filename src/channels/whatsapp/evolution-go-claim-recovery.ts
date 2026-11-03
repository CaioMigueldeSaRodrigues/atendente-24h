import type { ExpiredChannelClaim, PendingChannelReply } from "../../core/outbound-worker.js";
import { applyInterpretation, type ProcessMessageDependencies } from "../../core/process-message.js";
import type { EvolutionGoConversationLinkRepository } from "./evolution-go-conversation-link.js";
import { EVOLUTION_GO_WEBHOOK_LEASE_MS, type EvolutionGoWebhookReplayGuard } from "./evolution-go-webhook-replay-guard.js";
import type { EvolutionGoWebhookTransaction } from "./evolution-go-webhook-transaction.js";

export type EvolutionGoClaimRecoveryDependencies = {
  replayGuard: EvolutionGoWebhookReplayGuard;
  linkRepository: Pick<EvolutionGoConversationLinkRepository, "runAtomically">;
  transaction: EvolutionGoWebhookTransaction;
  processDependencies: ProcessMessageDependencies;
  // Called once the recovery has committed with a handoff it opened (an AI_FAILURE), so the workshop can be told.
  onHandoffOpened?: (businessId: string) => void;
};

// The same path as a failed LLM call: claim, then fixed reply, handoff and receipt in one transaction, so recovery runs once.
export async function recoverEvolutionGoClaim(
  claim: ExpiredChannelClaim,
  dependencies: EvolutionGoClaimRecoveryDependencies,
): Promise<PendingChannelReply | null> {
  const { replayGuard, linkRepository, transaction, processDependencies } = dependencies;
  const { businessId, instanceName, externalMessageId, conversationId, senderJid, content } = claim;
  const claimedAt = processDependencies.now();
  const claimToken = processDependencies.generateId("webhook-claim");
  const taken = await replayGuard.claim({
    businessId,
    instanceName,
    externalMessageId,
    receivedAt: claim.receivedAt,
    claimedAt,
    leaseUntil: new Date(Date.parse(claimedAt) + EVOLUTION_GO_WEBHOOK_LEASE_MS).toISOString(),
    claimToken,
  });
  if (taken.status !== "claimed") return null;

  const claimKey = { businessId, instanceName, externalMessageId, claimToken };
  let handoffOpened = false;
  const pending = await transaction.run(async () => {
    if (!(await replayGuard.lockForProcessing(claimKey))) return null;
    return linkRepository.runAtomically({ businessId, instanceName, senderJid }, async () => {
      const { reply, silenced, handoffOpened: opened } = await applyInterpretation({ businessId, conversationId, content }, { status: "FAILED" }, processDependencies);
      handoffOpened = opened === true;
      // A person took the conversation meanwhile: nothing is owed to the customer.
      if (silenced) {
        if (!(await replayGuard.complete(claimKey))) throw new Error("Unable to persist Evolution Go webhook result");
        return null;
      }
      if (!(await replayGuard.markProcessed({ ...claimKey, conversationId, senderJid, reply }))) {
        throw new Error("Unable to persist Evolution Go webhook result");
      }
      return { businessId, instanceName, externalMessageId, conversationId, senderJid, reply, attempts: 0 };
    });
  });
  if (handoffOpened && pending !== null) dependencies.onHandoffOpened?.(businessId);
  return pending;
}
