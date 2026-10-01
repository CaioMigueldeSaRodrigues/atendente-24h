export interface EvolutionGoConversationLink {
  businessId: string;
  instanceName: string;
  senderJid: string;
  conversationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvolutionGoConversationLinkRepository {
  runAtomically<T>(
    key: Pick<EvolutionGoConversationLink, "businessId" | "instanceName" | "senderJid">,
    operation: () => Promise<T>,
  ): Promise<T>;
  findBySender(
    businessId: string,
    instanceName: string,
    senderJid: string,
  ): Promise<EvolutionGoConversationLink | null>;
  findByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<EvolutionGoConversationLink | null>;
  save(link: EvolutionGoConversationLink): Promise<void>;
}
