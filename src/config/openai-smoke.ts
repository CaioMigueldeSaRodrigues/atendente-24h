import OpenAI from "openai";
import { OpenAIMessageInterpreter } from "../integrations/openai-message-interpreter.js";

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  if (!model) {
    throw new Error("OPENAI_MODEL is required");
  }

  const client = new OpenAI({ apiKey });
  const interpreter = new OpenAIMessageInterpreter(client, model);

  const result = await interpreter.interpret({
    businessId: "smoke-business",
    conversationId: "smoke-conversation",
    content: "Tenho um Corolla 2020 e quero orçamento para trocar as pastilhas de freio.",
    history: [],
  });

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  console.error(
    "Smoke test failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
