export type LlmEnvironment = {
  provider: "openai" | "openrouter";
  apiKey: string;
  model: string;
  baseURL: string;
  defaultHeaders: Record<string, string>;
};

export function readLlmEnvironment(environment: NodeJS.ProcessEnv): LlmEnvironment {
  const provider = environment.LLM_PROVIDER?.trim();
  if (provider !== "openai" && provider !== "openrouter") {
    throw new Error("LLM_PROVIDER must be explicitly set to openai or openrouter");
  }
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const prefix = provider === "openai" ? "OPENAI" : "OPENROUTER";
  const defaultHeaders: Record<string, string> = {};
  if (provider === "openrouter") {
    const referer = environment.OPENROUTER_HTTP_REFERER?.trim();
    const appName = environment.OPENROUTER_APP_NAME?.trim();
    if (referer) defaultHeaders["HTTP-Referer"] = referer;
    if (appName) defaultHeaders["X-Title"] = appName;
  }
  return {
    provider,
    apiKey: required(`${prefix}_API_KEY`),
    model: required(`${prefix}_MODEL`),
    baseURL: provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1",
    defaultHeaders,
  };
}
