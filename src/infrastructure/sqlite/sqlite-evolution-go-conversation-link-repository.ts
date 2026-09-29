import type {
  EvolutionGoConversationLink,
  EvolutionGoConversationLinkRepository,
} from "../../channels/whatsapp/evolution-go-conversation-link.js";
import type { DatabaseSync } from "node:sqlite";

type EvolutionGoConversationLinkRow = {
  business_id: string;
  instance_name: string;
  sender_jid: string;
  conversation_id: string;
  created_at: string;
  updated_at: string;
};

export class SqliteEvolutionGoConversationLinkRepository implements EvolutionGoConversationLinkRepository {
  constructor(private readonly database: DatabaseSync) {}

  async findBySender(
    businessId: string,
    instanceName: string,
    senderJid: string,
  ): Promise<EvolutionGoConversationLink | null> {
    try {
      const row = this.database.prepare(`
        SELECT * FROM evolution_go_conversation_links
        WHERE business_id = ? AND instance_name = ? AND sender_jid = ?
      `).get(businessId, instanceName, senderJid) as EvolutionGoConversationLinkRow | undefined;

      return row ? {
        businessId: row.business_id,
        instanceName: row.instance_name,
        senderJid: row.sender_jid,
        conversationId: row.conversation_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } : null;
    } catch {
      throw new Error("Failed to load Evolution Go conversation link");
    }
  }

  async save(link: EvolutionGoConversationLink): Promise<void> {
    try {
      this.database.prepare(`
        INSERT INTO evolution_go_conversation_links (
          business_id, instance_name, sender_jid, conversation_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (business_id, instance_name, sender_jid) DO UPDATE SET
          conversation_id = excluded.conversation_id,
          updated_at = excluded.updated_at
      `).run(
        link.businessId,
        link.instanceName,
        link.senderJid,
        link.conversationId,
        link.createdAt,
        link.updatedAt,
      );
    } catch {
      throw new Error("Failed to save Evolution Go conversation link");
    }
  }
}
