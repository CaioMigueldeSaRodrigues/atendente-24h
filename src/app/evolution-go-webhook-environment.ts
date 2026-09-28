import type { EvolutionGoWebhookCredential } from "../channels/whatsapp/evolution-go-webhook-auth.js";

export function readEvolutionGoWebhookCredential(
  environment: Readonly<Record<string, string | undefined>>,
  businessId: string,
): EvolutionGoWebhookCredential | undefined {
  const instanceName = environment.EVOLUTION_GO_INSTANCE_NAME?.trim() ?? "";
  const instanceToken = environment.EVOLUTION_GO_INSTANCE_TOKEN?.trim() ?? "";
  const hasInstanceName = instanceName.length > 0;
  const hasInstanceToken = instanceToken.length > 0;

  if (!hasInstanceName && !hasInstanceToken) return undefined;
  if (!hasInstanceName || !hasInstanceToken) {
    throw new Error("Evolution Go webhook configuration is incomplete");
  }

  return { instanceName, instanceToken, businessId };
}
