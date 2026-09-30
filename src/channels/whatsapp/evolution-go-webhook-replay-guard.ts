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

export interface EvolutionGoWebhookReplayGuard {
  claim(input: EvolutionGoWebhookReplayClaim): EvolutionGoWebhookClaimResult | Promise<EvolutionGoWebhookClaimResult>;
  lockForProcessing(input: EvolutionGoWebhookReplayClaimKey): boolean | Promise<boolean>;
  markProcessed(input: EvolutionGoWebhookReplayClaimKey & EvolutionGoProcessedWebhook): boolean | Promise<boolean>;
  markSent(input: Omit<EvolutionGoWebhookReplayClaimKey, "claimToken"> & { sentAt: string }): boolean | Promise<boolean>;
  complete(input: EvolutionGoWebhookReplayClaimKey): boolean | Promise<boolean>;
  release(input: EvolutionGoWebhookReplayClaimKey): boolean | Promise<boolean>;
}
