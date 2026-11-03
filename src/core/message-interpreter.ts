import type { AIInterpretation } from "./domain/types.js";
import type { Message } from "./domain/entities.js";
import { redactPersonalData } from "./redact-personal-data.js";
import type { BusinessFacts } from "./business-profile.js";

export const LLM_TIMEOUT_MS = 20_000;
export const LLM_MAX_OUTPUT_TOKENS = 1200;
export const LLM_HISTORY_WINDOW = 20;

export type MessageInterpreterInput = {
  businessId: string;
  conversationId: string;
  content: string;
  history: readonly Message[];
  // Registered by the workshop and sent as data: the model answers from these and nothing else.
  businessFacts?: BusinessFacts;
  localDateTime?: string;
};

export interface MessageInterpreter {
  interpret(input: MessageInterpreterInput): Promise<AIInterpretation>;
}

export function buildInterpreterContext(input: MessageInterpreterInput) {
  return {
    content: redactPersonalData(input.content),
    history: input.history.slice(-LLM_HISTORY_WINDOW).map(({ senderType, content }) => ({
      senderType,
      content: redactPersonalData(content),
    })),
    ...(input.businessFacts === undefined ? {} : { businessFacts: input.businessFacts }),
    ...(input.localDateTime === undefined ? {} : { localDateTime: input.localDateTime }),
  };
}
