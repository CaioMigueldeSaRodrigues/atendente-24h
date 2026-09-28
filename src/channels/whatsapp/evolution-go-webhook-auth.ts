import { timingSafeEqual } from "node:crypto";

export interface EvolutionGoWebhookCredential {
  instanceName: string;
  instanceToken: string;
  businessId: string;
}

export interface AuthenticatedEvolutionGoWebhook {
  instanceName: string;
  businessId: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function authenticateEvolutionGoWebhook(
  payload: unknown,
  credentials: readonly EvolutionGoWebhookCredential[],
): AuthenticatedEvolutionGoWebhook | null {
  if (!isRecord(payload)) return null;

  const instanceName = nonEmptyString(payload.instanceName);
  const instanceToken = nonEmptyString(payload.instanceToken);
  if (!instanceName || !instanceToken) return null;

  const credential = credentials.find((candidate) =>
    candidate.instanceName === instanceName &&
    nonEmptyString(candidate.instanceToken) !== undefined &&
    nonEmptyString(candidate.businessId) !== undefined,
  );
  if (!credential) return null;

  const receivedTokenBytes = Buffer.from(instanceToken, "utf8");
  const configuredTokenBytes = Buffer.from(credential.instanceToken, "utf8");
  if (
    receivedTokenBytes.length !== configuredTokenBytes.length ||
    !timingSafeEqual(receivedTokenBytes, configuredTokenBytes)
  ) {
    return null;
  }

  return {
    instanceName: credential.instanceName,
    businessId: credential.businessId,
  };
}
