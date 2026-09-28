export interface EvolutionGoInboundTextMessage {
  instanceName: string;
  externalMessageId: string;
  senderJid: string;
  senderName?: string;
  content: string;
  occurredAt: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function parseEvolutionGoInboundText(
  payload: unknown,
): EvolutionGoInboundTextMessage | null {
  if (!isRecord(payload) || payload.event !== "Message") return null;

  const instanceName = nonEmptyString(payload.instanceName);
  const data = payload.data;
  if (!instanceName || !isRecord(data) || !isRecord(data.Info) || !isRecord(data.Message)) {
    return null;
  }

  const info = data.Info;
  if (info.Type !== "text" || info.IsFromMe === true || info.IsGroup === true) return null;

  const message = data.Message;
  const content = nonEmptyString(message.conversation)
    ?? (isRecord(message.extendedTextMessage)
      ? nonEmptyString(message.extendedTextMessage.text)
      : undefined);
  const externalMessageId = nonEmptyString(info.ID);
  const senderJid = nonEmptyString(info.Sender) ?? nonEmptyString(info.Chat);
  const timestamp = info.Timestamp;
  const occurredAt = typeof timestamp === "string" && timestamp.trim().length > 0
    ? timestamp
    : typeof timestamp === "number" && Number.isFinite(timestamp)
      ? String(timestamp)
      : undefined;

  if (!content || !externalMessageId || !senderJid || !occurredAt) return null;

  const senderName = nonEmptyString(info.PushName);
  return {
    instanceName,
    externalMessageId,
    senderJid,
    ...(senderName ? { senderName } : {}),
    content,
    occurredAt,
  };
}
