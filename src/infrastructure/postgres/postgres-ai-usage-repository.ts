import type { PostgresDatabase } from "./postgres-database.js";
import type { AiModelPrice, AiUsageEvent, AiUsageMonth, AiUsageQueryService, AiUsageStore, AiUsageSummary } from "../../core/ai-usage.js";

type Row = Record<string, unknown>;

export class PostgresAiUsageRepository implements AiUsageStore, AiUsageQueryService {
  constructor(private readonly database: PostgresDatabase) {}

  async findPrice(input: { provider: string; model: string; at: string }): Promise<AiModelPrice | null> {
    const result = await this.database.query<Row>(`SELECT provider, model, pricing_version,
      input_price_per_million, cached_input_price_per_million, output_price_per_million,
      effective_from, effective_to
      FROM ai_model_prices
      WHERE provider=$1 AND model=$2 AND effective_from <= $3::timestamptz
        AND (effective_to IS NULL OR effective_to > $3::timestamptz)
      ORDER BY effective_from DESC
      LIMIT 1`, [input.provider, input.model, input.at]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      provider: text(row, "provider"),
      model: text(row, "model"),
      pricingVersion: text(row, "pricing_version"),
      inputPricePerMillion: number(row, "input_price_per_million"),
      cachedInputPricePerMillion: number(row, "cached_input_price_per_million"),
      outputPricePerMillion: number(row, "output_price_per_million"),
      effectiveFrom: dateText(row, "effective_from"),
      ...(row.effective_to == null ? {} : { effectiveTo: dateText(row, "effective_to") }),
    };
  }

  async append(event: AiUsageEvent): Promise<void> {
    await this.database.query(`INSERT INTO ai_usage_events(
      id,business_id,conversation_id,provider,model,provider_request_id,
      input_tokens,cached_input_tokens,output_tokens,total_tokens,
      queue_time_ms,prompt_time_ms,completion_time_ms,total_time_ms,
      cost_usd,fx_rate,cost_brl,billable_brl,pricing_version,status,error_code,created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, [
      event.id, event.businessId, event.conversationId ?? null, event.provider, event.model,
      event.providerRequestId ?? null, event.inputTokens, event.cachedInputTokens, event.outputTokens,
      event.totalTokens, event.queueTimeMs ?? null, event.promptTimeMs ?? null,
      event.completionTimeMs ?? null, event.totalTimeMs, event.costUsd ?? null, event.fxRate ?? null,
      event.costBrl ?? null, event.billableBrl ?? null, event.pricingVersion ?? null,
      event.status ?? "SUCCEEDED", event.errorCode ?? null, event.createdAt,
    ]);
  }

  async getSummary(input: { businessId: string; period?: { from?: string; to?: string } }): Promise<AiUsageSummary> {
    const { where, params } = periodWhere(input.businessId, input.period);
    const result = await this.database.query<Row>(`SELECT COUNT(*) AS calls,
      COALESCE(SUM(input_tokens),0) AS input_tokens,
      COALESCE(SUM(cached_input_tokens),0) AS cached_input_tokens,
      COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(total_tokens),0) AS total_tokens,
      COALESCE(SUM(cost_usd),0) AS cost_usd,
      COALESCE(SUM(cost_brl),0) AS cost_brl,
      COALESCE(SUM(billable_brl),0) AS billable_brl,
      AVG(total_time_ms) AS average_latency_ms,
      COUNT(*) FILTER (WHERE status='FAILED') AS error_count
      FROM ai_usage_events WHERE ${where}`, params);
    return mapSummary(input.businessId, input.period, result.rows[0] ?? {});
  }

  async getMonthly(input: { businessId: string; period?: { from?: string; to?: string } }): Promise<AiUsageMonth[]> {
    const { where, params } = periodWhere(input.businessId, input.period);
    const result = await this.database.query<Row>(`SELECT date_trunc('month', created_at AT TIME ZONE 'UTC') AS month,
      COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS input_tokens,
      COALESCE(SUM(cached_input_tokens),0) AS cached_input_tokens,
      COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(total_tokens),0) AS total_tokens,
      COALESCE(SUM(cost_usd),0) AS cost_usd, COALESCE(SUM(cost_brl),0) AS cost_brl,
      COALESCE(SUM(billable_brl),0) AS billable_brl, AVG(total_time_ms) AS average_latency_ms,
      COUNT(*) FILTER (WHERE status='FAILED') AS error_count
      FROM ai_usage_events WHERE ${where}
      GROUP BY 1 ORDER BY 1`, params);
    return result.rows.map((row) => {
      const summary = mapSummary(input.businessId, input.period, row);
      return {
        month: new Date(dateText(row, "month")).toISOString().slice(0, 7),
        calls: summary.calls,
        inputTokens: summary.inputTokens,
        cachedInputTokens: summary.cachedInputTokens,
        outputTokens: summary.outputTokens,
        totalTokens: summary.totalTokens,
        costUsd: summary.costUsd,
        costBrl: summary.costBrl,
        billableBrl: summary.billableBrl,
        averageLatencyMs: summary.averageLatencyMs,
        errorCount: summary.errorCount,
        errorRate: summary.errorRate,
      };
    });
  }
}

function periodWhere(businessId: string, period: { from?: string; to?: string } | undefined): { where: string; params: unknown[] } {
  const params: unknown[] = [businessId];
  const clauses = ["business_id=$1"];
  if (period?.from !== undefined) { params.push(period.from); clauses.push(`created_at >= $${params.length}::timestamptz`); }
  if (period?.to !== undefined) { params.push(period.to); clauses.push(`created_at < $${params.length}::timestamptz`); }
  return { where: clauses.join(" AND "), params };
}

function mapSummary(businessId: string, period: { from?: string; to?: string } | undefined, row: Row): AiUsageSummary {
  const calls = integer(row, "calls");
  const errorCount = integer(row, "error_count");
  return {
    businessId,
    period: period ?? {},
    calls,
    inputTokens: integer(row, "input_tokens"),
    cachedInputTokens: integer(row, "cached_input_tokens"),
    outputTokens: integer(row, "output_tokens"),
    totalTokens: integer(row, "total_tokens"),
    costUsd: number(row, "cost_usd"),
    costBrl: number(row, "cost_brl"),
    billableBrl: number(row, "billable_brl"),
    averageLatencyMs: row.average_latency_ms == null ? null : Math.round(number(row, "average_latency_ms")),
    errorCount,
    errorRate: calls === 0 ? 0 : errorCount / calls,
  };
}

function text(row: Row, key: string): string { return String(row[key]); }
function dateText(row: Row, key: string): string { return row[key] instanceof Date ? row[key].toISOString() : String(row[key]); }
function number(row: Row, key: string): number { return Number(row[key] ?? 0); }
function integer(row: Row, key: string): number { return Math.trunc(number(row, key)); }
