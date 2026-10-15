import type { AiUsageBillingConfig } from "../core/ai-usage.js";

export function readAiUsageBillingConfig(environment: NodeJS.ProcessEnv): AiUsageBillingConfig {
  const markupMultiplier = readNonNegative(environment.AI_BILLING_MARKUP_MULTIPLIER, 1, "AI_BILLING_MARKUP_MULTIPLIER");
  const rateText = environment.AI_USD_BRL_RATE?.trim();
  if (!rateText) return { markupMultiplier };
  const usdBrlRate = Number(rateText);
  if (!Number.isFinite(usdBrlRate) || usdBrlRate <= 0) throw new Error("AI_USD_BRL_RATE must be positive");
  return { markupMultiplier, usdBrlRate };
}

function readNonNegative(value: string | undefined, fallback: number, name: string): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be non-negative`);
  return parsed;
}
