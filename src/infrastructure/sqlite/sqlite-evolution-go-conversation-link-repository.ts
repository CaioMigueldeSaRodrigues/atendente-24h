import type {
  EvolutionGoConversationLink,
  EvolutionGoConversationLinkRepository,
} from "../../channels/whatsapp/evolution-go-conversation-link.js";
import type { DatabaseSync } from "node:sqlite";
import { withSqliteConnectionLock } from "./sqlite-connection-lock.js";

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

  async runAtomically<T>(
    _key: Pick<EvolutionGoConversationLink, "businessId" | "instanceName" | "senderJid">,
    operation: () => Promise<T>,
  ): Promise<T> {
    return withSqliteConnectionLock(this.database, async () => {
      let transactionStarted = false;
      try {
        await this.beginImmediateWithRetry();
        transactionStarted = true;
        const result = await operation();
        this.database.exec("COMMIT");
        transactionStarted = false;
        return result;
      } catch (cause) {
        if (transactionStarted) {
          try {
            this.database.exec("ROLLBACK");
          } catch {
            // Keep database details out of the public error.
          }
        }
        throw new Error("Failed to resolve Evolution Go conversation link", {
          cause: safeTransactionDiagnostic(cause),
        });
      }
    });
  }

  private async beginImmediateWithRetry(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        this.database.exec("BEGIN IMMEDIATE");
        return;
      } catch (error) {
        if (!isSqliteBusy(error) || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }

  async findBySender(
    businessId: string,
    instanceName: string,
    senderJid: string,
  ): Promise<EvolutionGoConversationLink | null> {
    try {
      const row = await withSqliteConnectionLock(this.database, () => this.database.prepare(`
        SELECT * FROM evolution_go_conversation_links
        WHERE business_id = ? AND instance_name = ? AND sender_jid = ?
      `).get(businessId, instanceName, senderJid)) as EvolutionGoConversationLinkRow | undefined;

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
      await withSqliteConnectionLock(this.database, () => this.database.prepare(`
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
      ));
    } catch {
      throw new Error("Failed to save Evolution Go conversation link");
    }
  }
}

function isSqliteBusy(error: unknown): boolean {
  return error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message);
}

function safeTransactionDiagnostic(cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : "";
  const safeMessage = message === "Failed to save Conversation"
    ? "Conversation persistence failed"
    : message === "Failed to load Conversation"
      ? "Conversation lookup failed"
      : message === "Failed to save Evolution Go conversation link"
        ? "Conversation link persistence failed"
        : message === "Failed to load Evolution Go conversation link"
          ? "Conversation link lookup failed"
          : "SQLite transaction failed";
  return new Error(safeMessage);
}
