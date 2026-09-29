import { once } from "node:events";
import { resolveEvolutionGoConversation } from "../../../src/channels/whatsapp/evolution-go-conversation-resolver.js";
import { SqliteConversationRepository } from "../../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { createSqliteDatabase } from "../../../src/infrastructure/sqlite/sqlite-database.js";
import { SqliteEvolutionGoConversationLinkRepository } from "../../../src/infrastructure/sqlite/sqlite-evolution-go-conversation-link-repository.js";

async function main(): Promise<void> {
  const filename = process.env["RESOLVER_DB_FILE"];
  const role = process.env["RESOLVER_WORKER_ROLE"];
  if (!filename || !role || !process.send) throw new Error("Worker configuration is invalid");

  const database = createSqliteDatabase({ filename });
  const linkRepository = new SqliteEvolutionGoConversationLinkRepository(database);
  const conversationRepository = new SqliteConversationRepository(database);

  const resolve = () => resolveEvolutionGoConversation({
    businessId: "business-process",
    instanceName: "instance-process",
    senderJid: "sender-process@synthetic.invalid",
  }, {
    conversationRepository,
    evolutionGoConversationLinkRepository: linkRepository,
    now: () => "2026-05-06T07:08:09.000Z",
    generateId: (prefix) => `${prefix}-${process.pid}`,
  });

  try {
    if (role === "holder") {
      process.send({ type: "ready" });
      await once(process, "message");
      await linkRepository.runAtomically({
        businessId: "business-process",
        instanceName: "instance-process",
        senderJid: "sender-process@synthetic.invalid",
      }, async () => {
        process.send?.({ type: "transaction-held" });
        await once(process, "message");
      });
      const result = await resolve();
      process.send({ type: "resolved", conversationId: result.conversation.id, created: result.created });
      process.send({ type: "released" });
    } else if (role === "resolver") {
      process.send({ type: "ready" });
      await once(process, "message");
      process.send({ type: "resolving" });
      const result = await resolve();
      process.send({ type: "resolved", conversationId: result.conversation.id, created: result.created });
    } else {
      throw new Error("Worker role is invalid");
    }
  } finally {
    database.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : "Worker failed"}\n`);
  process.exitCode = 1;
});
