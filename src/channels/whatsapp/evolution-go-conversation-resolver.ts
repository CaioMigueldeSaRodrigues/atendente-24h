import type { Conversation } from "../../core/domain/entities.js";
import { Channel, ConversationStatus } from "../../core/domain/enums.js";
import type { ConversationRepository } from "../../core/repositories.js";
import type { EvolutionGoConversationLinkRepository } from "./evolution-go-conversation-link.js";

export interface ResolveEvolutionGoConversationInput {
  businessId: string;
  instanceName: string;
  senderJid: string;
}

export interface ResolveEvolutionGoConversationDependencies {
  conversationRepository: ConversationRepository;
  evolutionGoConversationLinkRepository: EvolutionGoConversationLinkRepository;
  now: () => string;
  generateId: (prefix: string) => string;
}

export interface ResolvedEvolutionGoConversation {
  conversation: Conversation;
  created: boolean;
}

const RESOLUTION_ERROR = "Unable to resolve WhatsApp conversation";

export async function resolveEvolutionGoConversation(
  input: ResolveEvolutionGoConversationInput,
  dependencies: ResolveEvolutionGoConversationDependencies,
): Promise<ResolvedEvolutionGoConversation> {
  if (
    !nonEmpty(input.businessId) ||
    !nonEmpty(input.instanceName) ||
    !nonEmpty(input.senderJid)
  ) {
    throw new Error(RESOLUTION_ERROR);
  }

  try {
    return await dependencies.evolutionGoConversationLinkRepository.runAtomically(input, async () => {
    const linkRepository = dependencies.evolutionGoConversationLinkRepository;
    const link = await linkRepository.findBySender(
      input.businessId,
      input.instanceName,
      input.senderJid,
    );

    if (link) {
      const existing = await dependencies.conversationRepository.findById(
        input.businessId,
        link.conversationId,
      );
      if (!existing || existing.channel !== Channel.WHATSAPP) {
        throw new Error("Linked conversation unavailable");
      }
      if (existing.status !== ConversationStatus.CLOSED) {
        return { conversation: existing, created: false };
      }

      const timestamp = dependencies.now();
      const conversation = newConversation(input.businessId, dependencies.generateId, timestamp);
      await dependencies.conversationRepository.save(conversation);
      await linkRepository.save({
        ...link,
        conversationId: conversation.id,
        updatedAt: timestamp,
      });
      return { conversation, created: true };
    }

    const timestamp = dependencies.now();
    const conversation = newConversation(input.businessId, dependencies.generateId, timestamp);
    await dependencies.conversationRepository.save(conversation);
    await linkRepository.save({
      businessId: input.businessId,
      instanceName: input.instanceName,
      senderJid: input.senderJid,
      conversationId: conversation.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { conversation, created: true };
    });
  } catch (cause) {
    throw new Error(RESOLUTION_ERROR, { cause: safeDiagnostic(cause) });
  }
}

function newConversation(
  businessId: string,
  generateId: (prefix: string) => string,
  timestamp: string,
): Conversation {
  return {
    id: generateId("conversation"),
    businessId,
    channel: Channel.WHATSAPP,
    status: ConversationStatus.ACTIVE,
    startedAt: timestamp,
    lastMessageAt: timestamp,
  };
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function safeDiagnostic(cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : "";
  const nestedMessage = cause instanceof Error && cause.cause instanceof Error
    ? cause.cause.message
    : "";
  if (
    message === "Failed to resolve Evolution Go conversation link" &&
    [
      "Conversation persistence failed",
      "Conversation lookup failed",
      "Conversation link persistence failed",
      "Conversation link lookup failed",
      "SQLite transaction failed",
    ].includes(nestedMessage)
  ) {
    return new Error(nestedMessage);
  }
  const safeMessage = message === "Linked conversation unavailable"
    ? "Linked conversation is missing or not WhatsApp"
    : message === "Failed to save Conversation"
      ? "Conversation persistence failed"
      : message === "Failed to load Conversation"
        ? "Conversation lookup failed"
        : message === "Failed to save Evolution Go conversation link"
          ? "Conversation link persistence failed"
          : message === "Failed to load Evolution Go conversation link"
            ? "Conversation link lookup failed"
            : "Atomic conversation resolution failed";
  return new Error(safeMessage);
}
