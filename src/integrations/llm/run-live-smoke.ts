import { createMessageInterpreter } from "./create-message-interpreter.js";
import { readLlmEnvironment } from "./llm-environment.js";
import { LIVE_SMOKE_INPUT, getLiveSmokeFlags, validateLiveSmoke } from "./live-smoke-validation.js";
import { APIError, APIConnectionTimeoutError, APIConnectionError } from "openai";

async function main(): Promise<void> {
  // Executado somente pelo comando opt-in. Nenhum runtime, repositório ou canal.
  const config = readLlmEnvironment(process.env);
  const attempt = Number(process.argv[2] ?? "1");
  if (![1, 2, 3].includes(attempt)) throw new Error("Invalid diagnostic attempt");
  const summary = { provider: config.provider, model: config.model, attempt };
  let httpStatus: number | null = null;
  // Instrumentação exclusiva deste processo diagnóstico. Não inspeciona request,
  // headers ou corpos e devolve a Response original ao interpreter real.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    httpStatus = response.status;
    return response;
  };
  const transport = () => ({
    responsesApiResponded: httpStatus !== null,
    httpStatus,
    authenticated: httpStatus !== null && httpStatus >= 200 && httpStatus < 300
      ? true : httpStatus === 401 || httpStatus === 403 ? false : null,
  });
  try {
    const result = await createMessageInterpreter(config).interpret({
      businessId: "live-smoke-synthetic",
      conversationId: "live-smoke-synthetic",
      content: LIVE_SMOKE_INPUT,
      history: [],
    });
    const validation = validateLiveSmoke(result);
    console.log(JSON.stringify({ ...summary,
      status: validation.passed ? "PASS" : "SEMANTIC_FAILURE",
      transport: transport(), structuredOutputParsed: true,
      flags: getLiveSmokeFlags(result),
    }));
    if (!validation.passed) process.exitCode = 1;
  } catch (error: unknown) {
    // Erros externos podem conter headers, corpos e credenciais. Não os imprimir.
    const failure = error instanceof APIError && Number.isInteger(error.status)
      ? `HTTP_${error.status}`
      : error instanceof APIConnectionTimeoutError ? "TIMEOUT"
      : error instanceof APIConnectionError ? "CONNECTION"
      : "STRUCTURED_OUTPUT";
    console.log(JSON.stringify({ ...summary,
      status: error instanceof APIConnectionTimeoutError ? "TIMEOUT" : "EXTERNAL_ERROR",
      failure, transport: transport(), structuredOutputParsed: httpStatus === null ? null : false,
      flags: null,
    }));
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch(() => {
  console.error("FAIL: LIVE CONFIGURATION FAILURE; confira LLM_PROVIDER e as variáveis do provider selecionado.");
  process.exitCode = 1;
});
