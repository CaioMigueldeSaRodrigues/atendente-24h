export interface EvolutionGoInboundTextMessage {
  instanceName: string;
  externalMessageId: string;
  senderJid: string;
  senderName?: string;
  content: string;
  occurredAt: string;
}

export const UNSUPPORTED_MESSAGE_CONTENT = "[mensagem sem texto]";

// A reaction is not a request; answering one with the fixed text would be noise.
const SILENT_MESSAGE_TYPES: ReadonlySet<unknown> = new Set(["text", "reaction"]);

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
  const inbound = readInboundMessage(payload);
  if (inbound === null || inbound.info.Type !== "text") return null;

  const message = inbound.message;
  const content = nonEmptyString(message.conversation)
    ?? (isRecord(message.extendedTextMessage)
      ? nonEmptyString(message.extendedTextMessage.text)
      : undefined);
  return content ? { ...inbound.normalized, content } : null;
}

export function parseEvolutionGoUnsupportedMessage(
  payload: unknown,
): EvolutionGoInboundTextMessage | null {
  const inbound = readInboundMessage(payload);
  if (inbound === null || typeof inbound.info.Type !== "string" || SILENT_MESSAGE_TYPES.has(inbound.info.Type)) return null;
  return { ...inbound.normalized, content: UNSUPPORTED_MESSAGE_CONTENT };
}

function readInboundMessage(payload: unknown) {
  if (!isRecord(payload) || payload.event !== "Message") return null;

  const instanceName = nonEmptyString(payload.instanceName);
  const data = payload.data;
  if (!instanceName || !isRecord(data) || !isRecord(data.Info) || !isRecord(data.Message)) {
    return null;
  }

  const info = data.Info;
  if (info.IsFromMe !== false || info.IsGroup === true) return null;

  const externalMessageId = nonEmptyString(info.ID);
  // Sender may carry a device (5511...:12@s.whatsapp.net); Chat is the conversation's plain JID. Groups and own messages left above.
  const senderJid = nonEmptyString(info.Chat) ?? nonEmptyString(info.Sender);
  const timestamp = info.Timestamp;
  const occurredAt = typeof timestamp === "string" && timestamp.trim().length > 0
    ? timestamp
    : typeof timestamp === "number" && Number.isFinite(timestamp)
      ? String(timestamp)
      : undefined;

  if (!externalMessageId || !senderJid || !occurredAt) return null;

  const senderName = nonEmptyString(info.PushName);
  return {
    info,
    message: data.Message,
    normalized: {
      instanceName,
      externalMessageId,
      senderJid,
      ...(senderName ? { senderName } : {}),
      occurredAt,
    },
  };
}
