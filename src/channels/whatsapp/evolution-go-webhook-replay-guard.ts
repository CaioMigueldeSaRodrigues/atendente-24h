export interface EvolutionGoWebhookReplayClaim {
  businessId: string;
  instanceName: string;
  externalMessageId: string;
  receivedAt: string;
}

export interface EvolutionGoWebhookReplayGuard {
  claim(input: EvolutionGoWebhookReplayClaim): boolean;
}
