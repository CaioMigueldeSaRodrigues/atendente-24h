import type { ChannelTextMessage, ChannelTextSender } from "../channel-text-sender.js";

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

  async sendText(message: EvolutionGoTextMessage): Promise<void> {
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
      await response.json();
    } catch {
      throw new Error(SAFE_SEND_ERROR);
    }
  }
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}
