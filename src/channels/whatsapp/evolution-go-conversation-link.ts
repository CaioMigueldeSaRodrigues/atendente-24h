export interface EvolutionGoConversationLink {
  businessId: string;
  instanceName: string;
  senderJid: string;
  conversationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvolutionGoConversationLinkRepository {
  findBySender(
    businessId: string,
    instanceName: string,
    senderJid: string,
  ): Promise<EvolutionGoConversationLink | null>;
  save(link: EvolutionGoConversationLink): Promise<void>;
}
