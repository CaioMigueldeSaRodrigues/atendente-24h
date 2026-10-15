import type { ChannelTextMessage, ChannelTextSender, ChannelTextSendResult } from "../channel-text-sender.js";

export interface EvolutionGoTextSenderOptions {
  baseUrl: string;
  instanceToken: string;
  fetch?: typeof fetch;
}

export type EvolutionGoTextMessage = ChannelTextMessage;

const SAFE_SEND_ERROR = "Evolution Go text message could not be sent";

export class EvolutionGoTextSender implements ChannelTextSender {
  private readonly endpoint: string;
  private readonly instanceToken: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: EvolutionGoTextSenderOptions) {
    if (!nonEmpty(options.baseUrl) || !nonEmpty(options.instanceToken)) {
      throw new Error("Evolution Go sender configuration is invalid");
    }

    this.endpoint = `${options.baseUrl.replace(/\/+$/, "")}/send/text`;
    this.instanceToken = options.instanceToken;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async sendText(message: EvolutionGoTextMessage): Promise<ChannelTextSendResult> {
    if (!nonEmpty(message.recipientJid) || !nonEmpty(message.content)) {
      throw new Error("Evolution Go text message input is invalid");
    }

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.instanceToken,
        },
        body: JSON.stringify({
          number: message.recipientJid,
          text: message.content,
          formatJid: false,
        }),
      });
      if (!response.ok) throw new Error(SAFE_SEND_ERROR);
      const body = await response.json() as unknown;
      const providerMessageId = readProviderMessageId(body);
      if (!providerMessageId) throw new Error(SAFE_SEND_ERROR);
      return { providerMessageId };
    } catch {
      throw new Error(SAFE_SEND_ERROR);
    }
  }
}

function readProviderMessageId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const data = (body as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const info = (data as Record<string, unknown>).Info;
  if (typeof info !== "object" || info === null || Array.isArray(info)) return undefined;
  const id = (info as Record<string, unknown>).ID;
  return typeof id === "string" && id.trim().length > 0 ? id : undefined;
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}
