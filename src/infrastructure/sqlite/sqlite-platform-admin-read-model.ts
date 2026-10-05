import type { DatabaseSync } from "node:sqlite";
import { AdminPlan, type AdminPlan as AdminPlanType } from "../../core/admin-plan-entitlement.js";
import type { AdminPeriod } from "../../core/admin-read-model.js";
import { aggregatePlatformQuoteBenchmark, type PlatformFilters, type PlatformHealth, type PlatformIssue, type PlatformOverview, type PlatformPlanSummary, type PlatformQueryService, type PlatformOperationalMetrics } from "../../core/platform-admin-read-model.js";

type BusinessRow = { id: string; active: number; created_at: string; plan: AdminPlanType | null };
type IssueEvent = { type: string; businessId: string; plan: AdminPlanType | null; occurredAt: string };

export class SqlitePlatformAdminReadModel implements PlatformQueryService {
  constructor(private readonly database: DatabaseSync, private readonly options: { now?: () => string } = {}) {}

  async getOverview(input: PlatformFilters): Promise<PlatformOverview> {
    const businesses = this.businesses(input);
    const plans = this.planSummaries(input, businesses);
    const maxBusinesses = Math.max(0, ...plans.map((item) => item.businesses));
    const leaders = plans.filter((item) => maxBusinesses > 0 && item.businesses === maxBusinesses);
    const mostAdoptedPlan = leaders.length === 1 ? leaders[0]!.plan : null;
    const metrics = this.operationalMetrics(input, businesses);
    return {
      period: input.period ?? {},
      businesses: {
        total: businesses.length,
        active: businesses.filter((item) => item.active === 1).length,
        inactive: businesses.filter((item) => item.active !== 1).length,
        newInPeriod: businesses.filter((item) => inPeriod(item.created_at, input.period)).length,
      },
      plans,
      mostAdoptedPlan,
      metrics,
      geography: { status: "NOT_AVAILABLE", reason: "AutomotiveBusiness possui apenas endereço textual; cidade, estado e região estruturados não existem.", regions: [] },
    };
  }

  async getPlans(input: PlatformFilters): Promise<PlatformPlanSummary[]> {
    return this.planSummaries(input, this.businesses(input));
  }

  async getHealth(input: PlatformFilters): Promise<PlatformHealth> {
    const businesses = this.businesses(input);
    const issues = this.issueSummaries(input, businesses);
    const metrics = this.operationalMetrics(input, businesses);
    const pending = metrics.pendingRequests.value;
    const pendingIssues = pending !== undefined && (pending.betweenOneAndTwoHours > 0 || pending.overTwoHours > 0) ? 1 : 0;
    return { period: input.period ?? {}, status: issues.length === 0 && pendingIssues === 0 ? "HEALTHY" : "ATTENTION", incidents: issues.reduce((sum, item) => sum + item.occurrences, 0), businessesAffected: new Set(this.issueEvents(input, businesses).map((item) => item.businessId)).size, issues, pendingRequests: metrics.pendingRequests };
  }

  async getIssues(input: PlatformFilters): Promise<PlatformIssue[]> {
    return this.issueSummaries(input, this.businesses(input));
  }

  private businesses(input: PlatformFilters): BusinessRow[] {
    const rows = this.database.prepare(`
      SELECT b.id,b.active,b.created_at,p.plan
      FROM automotive_businesses b
      LEFT JOIN business_plan_assignments p ON p.business_id = b.id AND p.status = 'ACTIVE'
      ORDER BY b.created_at ASC,b.id ASC
    `).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id), active: Number(row.active), created_at: String(row.created_at),
      plan: row.plan === null || row.plan === undefined ? null : validPlan(String(row.plan)),
    })).filter((row) => input.plan === undefined || row.plan === input.plan).filter((row) => input.businessId === undefined || row.id === input.businessId).filter((row) => input.status === undefined || (input.status === "ACTIVE" ? row.active === 1 : row.active !== 1));
  }

  private planSummaries(input: PlatformFilters, businesses: BusinessRow[]): PlatformPlanSummary[] {
    const base = businesses.length;
    return [AdminPlan.BASIC, AdminPlan.INTERMEDIATE, AdminPlan.ADVANCED].map((plan) => {
      const scoped = businesses.filter((item) => item.plan === plan);
      const ids = scoped.map((item) => item.id);
      const conversations = this.count("conversations", ids, input.period, "last_message_at");
      const quoteRequests = this.count("quote_requests", ids, input.period, "requested_at");
      const deliveries = this.deliveryStats(ids, input.period);
      const stock = this.stockStats(ids, input.period);
      return { plan, businesses: scoped.length, sharePercent: base === 0 ? 0 : Number((scoped.length / base * 100).toFixed(2)), conversations, quoteRequests, deliveriesFailed: deliveries.failed, retries: deliveries.retries, stockChecks: stock.total, stockUnknown: stock.unknown };
    });
  }

  private operationalMetrics(input: PlatformFilters, businesses: BusinessRow[]): PlatformOperationalMetrics {
    const ids = businesses.map((item) => item.id);
    const source = "SQLite: QuoteRequest.requested_at/status/authorized_price_amount_cents e Conversation.started_at";
    const unavailable = (limitation: string) => ({ status: "NOT_AVAILABLE" as const, source, limitation });
    const pendingRows = this.rows("quote_requests", ids, input.period, "requested_at", "status IN ('REQUESTED','WAITING_INFORMATION','WAITING_BUSINESS')");
    const requestRows = this.rows("quote_requests", ids, input.period, "requested_at");
    const now = Date.parse(this.options.now?.() ?? new Date().toISOString());
    const pending = { total: pendingRows.length, underOneHour: 0, betweenOneAndTwoHours: 0, overTwoHours: 0 };
    for (const row of pendingRows) { const age = Math.max(0, now - Date.parse(String(row.requested_at))); if (age < 60 * 60 * 1000) pending.underOneHour++; else if (age < 2 * 60 * 60 * 1000) pending.betweenOneAndTwoHours++; else pending.overTwoHours++; }
    const quoteRows = this.rows("quote_requests", ids, input.period, "requested_at", "authorized_price_amount_cents IS NOT NULL");
    const quotes = aggregatePlatformQuoteBenchmark(quoteRows.map((row) => ({ businessId: String(row.business_id), amountCents: Number(row.authorized_price_amount_cents) })));
    return {
      activeAttendants: unavailable("Não existe heartbeat ou evento confiável de atendente ativo; AssistantHealthEvent registra saúde, não presença atual."),
      requests: { status: "REAL", value: { total: requestRows.length }, source: "QuoteRequest.requested_at" },
      pendingRequests: { status: "REAL", value: pending, source: "QuoteRequest.status + QuoteRequest.requested_at; relógio injetável do read model" },
      abandonmentByDelay: unavailable("Não existe motivo persistido de cancelamento/abandono; requer WAIT_TIME, PRICE, NO_STOCK, OTHER ou UNKNOWN."),
      quotes: { status: "REAL", value: quotes, source: "QuoteRequest.authorized_price_amount_cents" },
      segmentAdoption: unavailable("AutomotiveBusiness.business_type é tipo operacional, não segmento confiável; Mercado Mapeado é fonte separada."),
      planChurnBySegment: unavailable("BusinessPlanAssignment registra ACTIVE/ENDED, mas não possui changeType/reason para afirmar churn."),
      satisfaction: unavailable("Não existem CSAT, NPS, rating ou feedback persistidos."),
      attendanceGrowth: this.attendanceGrowth(input, ids),
      efficiency: unavailable("Não existe evento persistido que defina solicitação atendida; publicação de orçamento não é usada como sinônimo."),
    };
  }

  private attendanceGrowth(input: PlatformFilters, ids: string[]): PlatformOperationalMetrics["attendanceGrowth"] {
    const source = "Conversation.started_at";
    if (input.period?.from === undefined || input.period.to === undefined) return { status: "NOT_AVAILABLE", source, limitation: "Requer período com início e fim para comparação equivalente.", value: { current: 0, previous: 0, comparisonStatus: "NOT_AVAILABLE" } };
    const from = Date.parse(input.period.from); const to = Date.parse(input.period.to); const duration = to - from;
    if (!Number.isFinite(from) || !Number.isFinite(to) || duration <= 0) return { status: "NOT_AVAILABLE", source, limitation: "Período inválido para comparação.", value: { current: 0, previous: 0, comparisonStatus: "NOT_AVAILABLE" } };
    const current = this.count("conversations", ids, { from: input.period.from, to: input.period.to }, "started_at");
    const previous = this.count("conversations", ids, { from: new Date(from - duration).toISOString(), to: new Date(from).toISOString() }, "started_at");
    if (previous === 0) return { status: "NOT_AVAILABLE", source, limitation: "Período anterior sem atendimentos; crescimento percentual não é calculável.", value: { current, previous, comparisonStatus: "NOT_AVAILABLE" } };
    return { status: "REAL", source, value: { current, previous, growthPercent: Number(((current - previous) / previous * 100).toFixed(2)), comparisonStatus: "AVAILABLE" } };
  }

  private rows(table: string, ids: string[], period: AdminPeriod | undefined, column: string, extra = "TRUE"): Record<string, unknown>[] {
    if (ids.length === 0) return [];
    const values: string[] = [...ids]; const clauses = [`business_id IN (${ids.map(() => "?").join(",")})`, extra];
    if (period?.from !== undefined) { clauses.push(`${column} >= ?`); values.push(period.from); }
    if (period?.to !== undefined) { clauses.push(`${column} < ?`); values.push(period.to); }
    return this.database.prepare(`SELECT * FROM ${table} WHERE ${clauses.join(" AND ")}`).all(...values) as Record<string, unknown>[];
  }

  private issueSummaries(input: PlatformFilters, businesses: BusinessRow[]): PlatformIssue[] {
    const events = this.issueEvents(input, businesses).filter((event) => input.issueType === undefined || event.type === input.issueType);
    const selectedCount = businesses.length;
    const grouped = new Map<string, IssueEvent[]>();
    for (const event of events) (grouped.get(event.type) ?? (grouped.set(event.type, []), grouped.get(event.type)!)).push(event);
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([type, group]) => {
      const byPlan = [AdminPlan.BASIC, AdminPlan.INTERMEDIATE, AdminPlan.ADVANCED].map((plan) => {
        const planEvents = group.filter((item) => item.plan === plan);
        return { plan, occurrences: planEvents.length, businessesAffected: new Set(planEvents.map((item) => item.businessId)).size };
      }).filter((item) => item.occurrences > 0);
      return { type, occurrences: group.length, businessesAffected: new Set(group.map((item) => item.businessId)).size, affectedPercent: selectedCount === 0 ? 0 : Number((new Set(group.map((item) => item.businessId)).size / selectedCount * 100).toFixed(2)), byPlan, period: input.period ?? {} };
    });
  }

  private issueEvents(input: PlatformFilters, businesses: BusinessRow[]): IssueEvent[] {
    const byId = new Map(businesses.map((item) => [item.id, item.plan]));
    const events: IssueEvent[] = [];
    const ids = [...byId.keys()];
    if (ids.length === 0) return events;
    const placeholders = ids.map(() => "?").join(",");
    const deliveries = this.database.prepare(`SELECT business_id,status,attempts,updated_at FROM outbound_deliveries WHERE business_id IN (${placeholders})`).all(...ids) as Record<string, unknown>[];
    for (const row of deliveries) {
      const occurredAt = String(row.updated_at);
      if (!inPeriod(occurredAt, input.period)) continue;
      const plan = byId.get(String(row.business_id)) ?? null;
      if (row.status === "FAILED_RETRYABLE") events.push({ type: "DELIVERY_FAILED_RETRYABLE", businessId: String(row.business_id), plan, occurredAt });
      if (row.status === "FAILED_FINAL") events.push({ type: "DELIVERY_FAILED_FINAL", businessId: String(row.business_id), plan, occurredAt });
      if (Number(row.attempts) > 1) events.push({ type: "DELIVERY_RETRY", businessId: String(row.business_id), plan, occurredAt });
    }
    const stock = this.database.prepare(`SELECT business_id,availability,source,checked_at FROM stock_checks WHERE business_id IN (${placeholders})`).all(...ids) as Record<string, unknown>[];
    for (const row of stock) {
      const occurredAt = String(row.checked_at);
      if (!inPeriod(occurredAt, input.period)) continue;
      const plan = byId.get(String(row.business_id)) ?? null;
      if (row.availability === "UNKNOWN") events.push({ type: "STOCK_UNKNOWN", businessId: String(row.business_id), plan, occurredAt });
      if (row.source === "provider-unavailable") events.push({ type: "PROVIDER_UNAVAILABLE", businessId: String(row.business_id), plan, occurredAt });
    }
    const health = this.database.prepare(`SELECT business_id,event_type,occurred_at FROM assistant_health_events WHERE business_id IN (${placeholders})`).all(...ids) as Record<string, unknown>[];
    for (const row of health) {
      const occurredAt = String(row.occurred_at);
      if (inPeriod(occurredAt, input.period)) events.push({ type: `ASSISTANT_${String(row.event_type)}`, businessId: String(row.business_id), plan: byId.get(String(row.business_id)) ?? null, occurredAt });
    }
    return events;
  }

  private count(table: string, ids: string[], period: AdminPeriod | undefined, column: string): number {
    if (ids.length === 0) return 0;
    const values: string[] = [...ids];
    const clauses = [`business_id IN (${ids.map(() => "?").join(",")})`];
    if (period?.from !== undefined) { clauses.push(`${column} >= ?`); values.push(period.from); }
    if (period?.to !== undefined) { clauses.push(`${column} < ?`); values.push(period.to); }
    return Number((this.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${clauses.join(" AND ")}`).get(...values) as Record<string, unknown>).count ?? 0);
  }

  private deliveryStats(ids: string[], period: AdminPeriod | undefined): { failed: number; retries: number } {
    if (ids.length === 0) return { failed: 0, retries: 0 };
    const values: string[] = [...ids]; const clauses = [`business_id IN (${ids.map(() => "?").join(",")})`];
    if (period?.from !== undefined) { clauses.push("updated_at >= ?"); values.push(period.from); }
    if (period?.to !== undefined) { clauses.push("updated_at < ?"); values.push(period.to); }
    const rows = this.database.prepare(`SELECT status,attempts FROM outbound_deliveries WHERE ${clauses.join(" AND ")}`).all(...values) as Record<string, unknown>[];
    return { failed: rows.filter((row) => row.status === "FAILED_RETRYABLE" || row.status === "FAILED_FINAL").length, retries: rows.reduce((sum, row) => sum + Math.max(0, Number(row.attempts) - 1), 0) };
  }

  private stockStats(ids: string[], period: AdminPeriod | undefined): { total: number; unknown: number } {
    if (ids.length === 0) return { total: 0, unknown: 0 };
    const values: string[] = [...ids]; const clauses = [`business_id IN (${ids.map(() => "?").join(",")})`];
    if (period?.from !== undefined) { clauses.push("checked_at >= ?"); values.push(period.from); }
    if (period?.to !== undefined) { clauses.push("checked_at < ?"); values.push(period.to); }
    const rows = this.database.prepare(`SELECT availability FROM stock_checks WHERE ${clauses.join(" AND ")}`).all(...values) as Record<string, unknown>[];
    return { total: rows.length, unknown: rows.filter((row) => row.availability === "UNKNOWN").length };
  }
}

function validPlan(value: string): AdminPlanType {
  if (Object.values(AdminPlan).includes(value as AdminPlanType)) return value as AdminPlanType;
  throw new Error("Invalid business plan");
}

function inPeriod(value: string, period: AdminPeriod | undefined): boolean {
  return (period?.from === undefined || value >= period.from) && (period?.to === undefined || value < period.to);
}
