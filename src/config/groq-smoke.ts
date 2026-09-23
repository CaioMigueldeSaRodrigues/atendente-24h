import OpenAI from "openai";
import { GroqMessageInterpreter } from "../integrations/groq-message-interpreter.js";

async function main(): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  if (!model) {
    throw new Error("GROQ_MODEL is required");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
  const interpreter = new GroqMessageInterpreter(client, model);

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
