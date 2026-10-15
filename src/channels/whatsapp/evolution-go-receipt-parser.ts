export type EvolutionGoReceipt = {
  instanceName: string;
  providerMessageId: string;
  status: "DELIVERED" | "READ";
  occurredAt: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function parseEvolutionGoReceipt(payload: unknown): EvolutionGoReceipt | null {
  if (!isRecord(payload) || payload.event !== "Receipt") return null;
  const instanceName = nonEmptyString(payload.instanceName);
  const data = payload.data;
  if (!instanceName || !isRecord(data)) return null;
  const ids = data.MessageIDs;
  const providerMessageId = Array.isArray(ids) ? nonEmptyString(ids[0]) : undefined;
  const state = nonEmptyString(payload.state);
  const status = state === "Delivered" ? "DELIVERED" : state === "Read" ? "READ" : undefined;
  const timestamp = data.Timestamp;
  const occurredAt = typeof timestamp === "string" && timestamp.trim().length > 0
    ? timestamp
    : typeof timestamp === "number" && Number.isFinite(timestamp)
      ? new Date(timestamp * 1000).toISOString()
      : undefined;
  if (!providerMessageId || !status || !occurredAt) return null;
  return { instanceName, providerMessageId, status, occurredAt };
}
