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
  | { status: "duplicate" }
  | { status: "in_progress" };

export interface EvolutionGoWebhookReplayClaimKey {
  businessId: string;
  instanceName: string;
  externalMessageId: string;
  claimToken: string;
}

export interface EvolutionGoWebhookReplayGuard {
  claim(input: EvolutionGoWebhookReplayClaim): EvolutionGoWebhookClaimResult;
  complete(input: EvolutionGoWebhookReplayClaimKey): boolean;
  release(input: EvolutionGoWebhookReplayClaimKey): boolean;
}
