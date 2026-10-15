export type ChannelTextMessage = {
  recipientJid: string;
  content: string;
};

export type ChannelTextSendResult = {
  providerMessageId: string;
};

export interface ChannelTextSender {
  sendText(message: ChannelTextMessage): Promise<void | ChannelTextSendResult>;
}
