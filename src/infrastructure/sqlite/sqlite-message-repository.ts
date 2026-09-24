import type { Message } from "../../core/domain/entities.js";
import { Channel, SenderType } from "../../core/domain/enums.js";
import type { MessageRepository } from "../../core/repositories.js";
import type { DatabaseSync } from "node:sqlite";

type MessageRow = {
  id: string;
  business_id: string;
  conversation_id: string;
  sender_type: string;
  channel: string;
  content: string;
  external_message_id: string | null;
  created_at: string;
};

export class SqliteMessageRepository implements MessageRepository {
  constructor(private readonly database: DatabaseSync) {}

  async save(entity: Message): Promise<void> {
    try {
      this.database.prepare(`
        INSERT INTO messages (
          id, business_id, conversation_id, sender_type, channel, content,
          external_message_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (business_id, id) DO UPDATE SET
          conversation_id = excluded.conversation_id,
          sender_type = excluded.sender_type,
          channel = excluded.channel,
          content = excluded.content,
          external_message_id = excluded.external_message_id,
          created_at = excluded.created_at
      `).run(
        entity.id,
        entity.businessId,
        entity.conversationId,
        entity.senderType,
        entity.channel,
        entity.content,
        entity.externalMessageId ?? null,
        entity.createdAt,
      );
    } catch {
      throw new Error("Failed to save Message");
    }
  }

  async listByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<Message[]> {
    let rows: MessageRow[];
    try {
      rows = this.database.prepare(`
        SELECT * FROM messages
        WHERE business_id = ? AND conversation_id = ?
        ORDER BY created_at ASC, id ASC
      `).all(businessId, conversationId) as MessageRow[];
    } catch {
      throw new Error("Failed to load Messages");
    }

    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: MessageRow): Message {
    const senderType = Object.values(SenderType).find(
      (value) => value === row.sender_type,
    );
    const channel = Object.values(Channel).find((value) => value === row.channel);

    if (senderType === undefined || channel === undefined) {
      throw new Error("Failed to load Message");
    }

    return {
      id: row.id,
      businessId: row.business_id,
      conversationId: row.conversation_id,
      senderType,
      channel,
      content: row.content,
      ...(row.external_message_id !== null
        ? { externalMessageId: row.external_message_id }
        : {}),
      createdAt: row.created_at,
    };
  }
}
