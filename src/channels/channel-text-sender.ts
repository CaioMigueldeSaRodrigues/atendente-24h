export type ChannelTextMessage = {
  recipientJid: string;
  content: string;
};

export interface ChannelTextSender {
  sendText(message: ChannelTextMessage): Promise<void>;
}
