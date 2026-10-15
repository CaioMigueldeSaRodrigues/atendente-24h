export type AiUsageStatus = "SUCCEEDED" | "FAILED";

export type AiModelPrice = {
  provider: string;
  model: string;
  pricingVersion: string;
  inputPricePerMillion: number;
  cachedInputPricePerMillion: number;
  outputPricePerMillion: number;
  effectiveFrom: string;
  effectiveTo?: string;
};

export type AiUsageSnapshot = {
  provider: string;
  model: string;
  providerRequestId?: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  queueTimeMs?: number;
  promptTimeMs?: number;
  completionTimeMs?: number;
  totalTimeMs: number;
  status?: AiUsageStatus;
  errorCode?: string;
};

export type AiUsageEvent = AiUsageSnapshot & {
  id: string;
  businessId: string;
  conversationId?: string;
  costUsd?: number;
  fxRate?: number;
  costBrl?: number;
  billableBrl?: number;
  pricingVersion?: string;
  createdAt: string;
};

export type AiUsageSummary = {
  businessId: string;
  period: { from?: string; to?: string };
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costBrl: number;
  billableBrl: number;
  averageLatencyMs: number | null;
  errorCount: number;
  errorRate: number;
};

export type AiUsageMonth = Omit<AiUsageSummary, "businessId" | "period"> & { month: string };

export type AiUsagePeriod = { from?: string; to?: string };

export type AiUsageQueryService = {
  getSummary(input: { businessId: string; period?: AiUsagePeriod }): Promise<AiUsageSummary>;
  getMonthly(input: { businessId: string; period?: AiUsagePeriod }): Promise<AiUsageMonth[]>;
};

export type AiUsageStore = {
  findPrice(input: { provider: string; model: string; at: string }): Promise<AiModelPrice | null>;
  append(event: AiUsageEvent): Promise<void>;
};

export type AiUsageBillingConfig = {
  markupMultiplier: number;
  usdBrlRate?: number;
};

export type AiUsageRecorder = {
  record(input: {
    businessId: string;
    conversationId?: string;
    usage: AiUsageSnapshot;
    createdAt?: string;
  }): Promise<void>;
};

export function calculateAiCost(input: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  price: AiModelPrice;
  fxRate?: number;
  markupMultiplier: number;
}): { costUsd: number; costBrl?: number; billableBrl?: number } {
  validateTokenCount(input.inputTokens, "inputTokens");
  validateTokenCount(input.cachedInputTokens, "cachedInputTokens");
  validateTokenCount(input.outputTokens, "outputTokens");
  if (input.cachedInputTokens > input.inputTokens) throw new Error("cachedInputTokens cannot exceed inputTokens");
  if (!Number.isFinite(input.markupMultiplier) || input.markupMultiplier < 0) throw new Error("markupMultiplier must be non-negative");

  const uncachedInputTokens = input.inputTokens - input.cachedInputTokens;
  const costUsd = normalizeCost((
    uncachedInputTokens * input.price.inputPricePerMillion
    + input.cachedInputTokens * input.price.cachedInputPricePerMillion
    + input.outputTokens * input.price.outputPricePerMillion
  ) / 1_000_000);
  if (input.fxRate === undefined) return { costUsd };
  if (!Number.isFinite(input.fxRate) || input.fxRate <= 0) throw new Error("fxRate must be positive");
  const costBrl = normalizeCost(costUsd * input.fxRate);
  return { costUsd, costBrl, billableBrl: normalizeCost(costBrl * input.markupMultiplier) };
}

export class AiUsageMeasurementService implements AiUsageRecorder {
  constructor(
    private readonly store: AiUsageStore,
    private readonly config: AiUsageBillingConfig,
    private readonly generateId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async record(input: Parameters<AiUsageRecorder["record"]>[0]): Promise<void> {
    const createdAt = input.createdAt ?? this.now();
    const price = await this.store.findPrice({ provider: input.usage.provider, model: input.usage.model, at: createdAt });
    const cost = price === null ? undefined : calculateAiCost({
      inputTokens: input.usage.inputTokens,
      cachedInputTokens: input.usage.cachedInputTokens,
      outputTokens: input.usage.outputTokens,
      price,
      ...(this.config.usdBrlRate === undefined ? {} : { fxRate: this.config.usdBrlRate }),
      markupMultiplier: this.config.markupMultiplier,
    });
    await this.store.append({
      ...input.usage,
      id: this.generateId(),
      businessId: input.businessId,
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      ...(cost?.costUsd === undefined ? {} : { costUsd: cost.costUsd }),
      ...(cost?.costBrl === undefined ? {} : { costBrl: cost.costBrl }),
      ...(cost?.billableBrl === undefined ? {} : { billableBrl: cost.billableBrl }),
      ...(this.config.usdBrlRate === undefined ? {} : { fxRate: this.config.usdBrlRate }),
      ...(price === null ? {} : { pricingVersion: price.pricingVersion }),
      status: input.usage.status ?? "SUCCEEDED",
      createdAt,
    });
  }
}

function validateTokenCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function normalizeCost(value: number): number {
  // Keep 15 decimal places, matching NUMERIC(30,15) in PostgreSQL. This is
  // only floating-point normalization; billing/cent rounding belongs to the
  // final billing or aggregation layer, never to the captured event.
  return Number(value.toFixed(15));
}
