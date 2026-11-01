import { LLM_DAILY_CALLS_PER_BUSINESS_DEFAULT } from "../../core/llm-guard.js";

const OPENROUTER_FREE_MODEL = "openrouter/free";

export type LlmEnvironment = {
  provider: "openai" | "openrouter" | "groq";
  apiKey: string;
  model: string;
  baseURL: string;
  defaultHeaders: Record<string, string>;
};

export function readLlmEnvironment(environment: NodeJS.ProcessEnv): LlmEnvironment {
  const provider = environment.LLM_PROVIDER?.trim();
  if (provider !== "openai" && provider !== "openrouter" && provider !== "groq") {
    throw new Error("LLM_PROVIDER must be explicitly set to openai, openrouter or groq");
  }
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const prefix = provider === "openai" ? "OPENAI" : provider === "openrouter" ? "OPENROUTER" : "GROQ";
  const defaultHeaders: Record<string, string> = {};
  if (provider === "openrouter") {
    const referer = environment.OPENROUTER_HTTP_REFERER?.trim();
    const appName = environment.OPENROUTER_APP_NAME?.trim();
    if (referer) defaultHeaders["HTTP-Referer"] = referer;
    if (appName) defaultHeaders["X-Title"] = appName;
  }
  if (provider === "groq") defaultHeaders["Groq-Beta"] = "inference-metrics";
  const model = required(`${prefix}_MODEL`);
  if (model === OPENROUTER_FREE_MODEL && isProduction(environment)) {
    throw new Error(`${OPENROUTER_FREE_MODEL} is not allowed with NODE_ENV=production`);
  }
  return {
    provider,
    apiKey: required(`${prefix}_API_KEY`),
    model,
    baseURL: provider === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : provider === "groq"
        ? "https://api.groq.com/openai/v1"
        : "https://api.openai.com/v1",
    defaultHeaders,
  };
}

export function isProduction(environment: NodeJS.ProcessEnv): boolean {
  return environment.NODE_ENV?.trim() === "production";
}

export function readLlmDailyCallsPerBusiness(environment: NodeJS.ProcessEnv): number {
  const value = environment.LLM_DAILY_CALLS_PER_BUSINESS?.trim();
  if (!value) return LLM_DAILY_CALLS_PER_BUSINESS_DEFAULT;
  const calls = Number(value);
  if (!Number.isSafeInteger(calls) || calls < 1) throw new Error("LLM_DAILY_CALLS_PER_BUSINESS must be a positive integer");
  return calls;
}
