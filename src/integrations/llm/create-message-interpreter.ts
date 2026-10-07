import OpenAI from "openai";
import type { MessageInterpreter } from "../../core/message-interpreter.js";
import { OpenAIMessageInterpreter } from "../openai-message-interpreter.js";
import type { LlmEnvironment } from "./llm-environment.js";

export function createMessageInterpreter(config: LlmEnvironment): MessageInterpreter {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
    // Nunca encaminhar headers, credenciais ou corpos para o logger do SDK.
    logLevel: "off",
    timeout: 120_000,
    maxRetries: 0,
  });
  return new OpenAIMessageInterpreter(client, config.model);
}
