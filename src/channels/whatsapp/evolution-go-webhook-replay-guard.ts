export const EVOLUTION_GO_WEBHOOK_LEASE_MS = 5 * 60 * 1000;

export interface EvolutionGoWebhookReplayClaim {
  businessId: string;
  instanceName: string;
  externalMessageId: string;
  receivedAt: string;
  claimedAt: string;
  leaseUntil: string;
  claimToken: string;
}

export type EvolutionGoWebhookClaimResult =
  | { status: "claimed"; claimToken: string }
  | { status: "processed"; processed: EvolutionGoProcessedWebhook }
  | { status: "duplicate" }
  | { status: "in_progress" };

export interface EvolutionGoWebhookReplayClaimKey {
  businessId: string;
  instanceName: string;
  externalMessageId: string;
  claimToken: string;
}

export interface EvolutionGoProcessedWebhook {
  conversationId: string;
  senderJid: string;
  reply: string;
}

export type EvolutionGoProviderReceipt = {
  businessId: string;
  instanceName: string;
  providerMessageId: string;
  status: "DELIVERED" | "READ";
  occurredAt: string;
};

export interface EvolutionGoWebhookReplayGuard {
  claim(input: EvolutionGoWebhookReplayClaim): EvolutionGoWebhookClaimResult | Promise<EvolutionGoWebhookClaimResult>;
  lockForProcessing(input: EvolutionGoWebhookReplayClaimKey): boolean | Promise<boolean>;
  markProcessed(input: EvolutionGoWebhookReplayClaimKey & EvolutionGoProcessedWebhook): boolean | Promise<boolean>;
  markSent(input: Omit<EvolutionGoWebhookReplayClaimKey, "claimToken"> & { sentAt: string; providerMessageId?: string }): boolean | Promise<boolean>;
  applyProviderReceipt(input: EvolutionGoProviderReceipt): boolean | Promise<boolean>;
  complete(input: EvolutionGoWebhookReplayClaimKey): boolean | Promise<boolean>;
  release(input: EvolutionGoWebhookReplayClaimKey): boolean | Promise<boolean>;
  /** Keeps the claim but makes it available at once: a retry or the worker's recovery can take it over. */
  expireLease(input: EvolutionGoWebhookReplayClaimKey & { at: string }): boolean | Promise<boolean>;
}
