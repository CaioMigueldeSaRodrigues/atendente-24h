export type ChannelTextMessage = {
  recipientJid: string;
  content: string;
  // The provider resolves the number itself (9th digit, country code). Only for a typed number, never for a JID the channel gave us.
  formatJid?: boolean;
};

export type ChannelTextSendResult = {
  providerMessageId: string;
};

export interface ChannelTextSender {
  sendText(message: ChannelTextMessage): Promise<void | ChannelTextSendResult>;
}
