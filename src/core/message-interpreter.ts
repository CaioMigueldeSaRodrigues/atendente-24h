import type { AIInterpretation } from "./domain/types.js";
import type { Message } from "./domain/entities.js";

export type MessageInterpreterInput = {
  businessId: string;
  conversationId: string;
  content: string;
  history: readonly Message[];
};

export interface MessageInterpreter {
  interpret(input: MessageInterpreterInput): Promise<AIInterpretation>;
}
