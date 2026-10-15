import OpenAI from "openai";
import type { MessageInterpreter } from "../../core/message-interpreter.js";
import { OpenAIMessageInterpreter } from "../openai-message-interpreter.js";
import { GroqMessageInterpreter } from "../groq-message-interpreter.js";
import type { LlmEnvironment } from "./llm-environment.js";
import type { AiUsageRecorder } from "../../core/ai-usage.js";

export function createMessageInterpreter(
  config: LlmEnvironment,
  usageRecorder?: AiUsageRecorder,
  onUsageRecordingFailure?: (error: unknown) => void,
): MessageInterpreter {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
    // Nunca encaminhar headers, credenciais ou corpos para o logger do SDK.
    logLevel: "off",
    timeout: 120_000,
    maxRetries: 0,
  });
  const options = {
    provider: config.provider,
    ...(usageRecorder === undefined ? {} : { usageRecorder }),
    ...(onUsageRecordingFailure === undefined ? {} : { onUsageRecordingFailure }),
  };
  return config.provider === "groq"
    ? new GroqMessageInterpreter(client, config.model, options)
    : new OpenAIMessageInterpreter(client, config.model, options);
}
