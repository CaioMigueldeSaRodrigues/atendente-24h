import { AdminPlan, type AdminPlan as AdminPlanType } from "../../core/admin-plan-entitlement.js";
import type { AdminPeriod } from "../../core/admin-read-model.js";
import { aggregatePlatformQuoteBenchmark, type PlatformFilters, type PlatformHealth, type PlatformIssue, type PlatformOverview, type PlatformPlanSummary, type PlatformQueryService, type PlatformOperationalMetrics } from "../../core/platform-admin-read-model.js";
import type { PostgresDatabase } from "./postgres-database.js";

type Row = Record<string, unknown>;
type BusinessRow = { id: string; active: boolean; createdAt: string; plan: AdminPlanType | null };

export class PostgresPlatformAdminReadModel implements PlatformQueryService {
  constructor(private readonly database: PostgresDatabase, private readonly options: { now?: () => string } = {}) {}

  async getOverview(input: PlatformFilters): Promise<PlatformOverview> {
    const businesses = await this.businesses(input);
    const plans = await this.planSummaries(input, businesses);
    const max = Math.max(0, ...plans.map((item) => item.businesses));
    const leaders = plans.filter((item) => max > 0 && item.businesses === max);
    const metrics = await this.operationalMetrics(input, businesses);
    return {
      period: input.period ?? {},
      businesses: { total: businesses.length, active: businesses.filter((item) => item.active).length, inactive: businesses.filter((item) => !item.active).length, newInPeriod: businesses.filter((item) => inPeriod(item.createdAt, input.period)).length },
      plans,
      mostAdoptedPlan: leaders.length === 1 ? leaders[0]!.plan : null,
      geography: { status: "NOT_AVAILABLE", reason: "AutomotiveBusiness possui apenas endereço textual; cidade, estado e região estruturados não existem.", regions: [] },
      metrics,
    };
  }

  async getPlans(input: PlatformFilters): Promise<PlatformPlanSummary[]> {
    return this.planSummaries(input, await this.businesses(input));
  }

  async getHealth(input: PlatformFilters): Promise<PlatformHealth> {
    const businesses = await this.businesses(input);
    const issues = await this.issueSummaries(input, businesses);
    const events = await this.issueEvents(input, businesses);
    const metrics = await this.operationalMetrics(input, businesses);
    const pending = metrics.pendingRequests.value;
    const pendingIssues = pending !== undefined && (pending.betweenOneAndTwoHours > 0 || pending.overTwoHours > 0) ? 1 : 0;
    return { period: input.period ?? {}, status: issues.length === 0 && pendingIssues === 0 ? "HEALTHY" : "ATTENTION", incidents: issues.reduce((sum, item) => sum + item.occurrences, 0), businessesAffected: new Set(events.map((item) => String(item.business_id))).size, issues, pendingRequests: metrics.pendingRequests };
  }

  async getIssues(input: PlatformFilters): Promise<PlatformIssue[]> {
    return this.issueSummaries(input, await this.businesses(input));
  }

  private async businesses(input: PlatformFilters): Promise<BusinessRow[]> {
    const values: unknown[] = [];
    const clauses = ["TRUE"];
    if (input.plan !== undefined) { values.push(input.plan); clauses.push(`p.plan=$${values.length}`); }
    if (input.status !== undefined) { values.push(input.status === "ACTIVE"); clauses.push(`b.active=$${values.length}`); }
    const result = await this.database.query<Row>(`SELECT b.id,b.active,b.created_at,p.plan FROM automotive_businesses b LEFT JOIN business_plan_assignments p ON p.business_id=b.id AND p.status='ACTIVE' WHERE ${clauses.join(" AND ")} ORDER BY b.created_at ASC,b.id ASC`, values);
    return result.rows.map((row) => ({ id: String(row.id), active: Boolean(row.active), createdAt: String(row.created_at), plan: row.plan == null ? null : validPlan(String(row.plan)) })).filter((row) => input.businessId === undefined || row.id === input.businessId);
  }

  private async planSummaries(input: PlatformFilters, businesses: BusinessRow[]): Promise<PlatformPlanSummary[]> {
    const base = businesses.length;
    return Promise.all([AdminPlan.BASIC, AdminPlan.INTERMEDIATE, AdminPlan.ADVANCED].map(async (plan) => {
      const scoped = businesses.filter((item) => item.plan === plan);
      const ids = scoped.map((item) => item.id);
      const conversations = await this.count("conversations", "last_message_at", ids, input.period);
      const quoteRequests = await this.count("quote_requests", "requested_at", ids, input.period);
      const failed = await this.count("outbound_deliveries", "updated_at", ids, input.period, "status IN ('FAILED_RETRYABLE','FAILED_FINAL')");
      const retries = await this.countAttempts(ids, input.period);
      const stockChecks = await this.count("stock_checks", "checked_at", ids, input.period);
      const stockUnknown = await this.count("stock_checks", "checked_at", ids, input.period, "availability='UNKNOWN'");
      return { plan, businesses: scoped.length, sharePercent: base === 0 ? 0 : Number((scoped.length / base * 100).toFixed(2)), conversations, quoteRequests, deliveriesFailed: failed, retries, stockChecks, stockUnknown };
    }));
  }

  private async operationalMetrics(input: PlatformFilters, businesses: BusinessRow[]): Promise<PlatformOperationalMetrics> {
    const ids = businesses.map((item) => item.id);
    const source = "PostgreSQL: QuoteRequest.requested_at/status/authorized_price_amount_cents e Conversation.started_at";
    const unavailable = (limitation: string) => ({ status: "NOT_AVAILABLE" as const, source, limitation });
    const pendingRows = await this.rowsFor("quote_requests", ids, input.period, "requested_at", "status IN ('REQUESTED','WAITING_INFORMATION','WAITING_BUSINESS')");
    const requestRows = await this.rowsFor("quote_requests", ids, input.period, "requested_at", "TRUE");
    const now = Date.parse(this.options.now?.() ?? new Date().toISOString());
    const pending = { total: pendingRows.length, underOneHour: 0, betweenOneAndTwoHours: 0, overTwoHours: 0 };
    for (const row of pendingRows) { const age = Math.max(0, now - Date.parse(String(row.requested_at))); if (age < 3600000) pending.underOneHour++; else if (age < 7200000) pending.betweenOneAndTwoHours++; else pending.overTwoHours++; }
    const quoteRows = await this.rowsFor("quote_requests", ids, input.period, "requested_at", "authorized_price_amount_cents IS NOT NULL");
    const quotes = aggregatePlatformQuoteBenchmark(quoteRows.map((row) => ({ businessId: String(row.business_id), amountCents: Number(row.authorized_price_amount_cents) })));
    const growth = await this.growth(input, ids, source);
    return { activeAttendants: unavailable("Não existe heartbeat confiável de atendente ativo."), requests: { status: "REAL", value: { total: requestRows.length }, source: "QuoteRequest.requested_at" }, pendingRequests: { status: "REAL", value: pending, source: "QuoteRequest.status + QuoteRequest.requested_at; relógio do adapter" }, abandonmentByDelay: unavailable("Não existe motivo persistido de cancelamento/abandono."), quotes: { status: "REAL", value: quotes, source: "QuoteRequest.authorized_price_amount_cents" }, segmentAdoption: unavailable("AutomotiveBusiness.business_type não é segmento confiável."), planChurnBySegment: unavailable("BusinessPlanAssignment não possui changeType/reason."), satisfaction: unavailable("Não existem CSAT, NPS, rating ou feedback persistidos."), attendanceGrowth: growth, efficiency: unavailable("Não existe evento persistido que defina solicitação atendida.") };
  }

  private async growth(input: PlatformFilters, ids: string[], source: string): Promise<PlatformOperationalMetrics["attendanceGrowth"]> {
    if (input.period?.from === undefined || input.period.to === undefined) return { status: "NOT_AVAILABLE", source, limitation: "Requer período com início e fim.", value: { current: 0, previous: 0, comparisonStatus: "NOT_AVAILABLE" } };
    const from = Date.parse(input.period.from); const to = Date.parse(input.period.to); const duration = to - from;
    const current = await this.count("conversations", "started_at", ids, input.period);
    const previous = duration > 0 ? await this.count("conversations", "started_at", ids, { from: new Date(from - duration).toISOString(), to: new Date(from).toISOString() }) : 0;
    if (previous === 0) return { status: "NOT_AVAILABLE", source, limitation: "Período anterior sem atendimentos.", value: { current, previous, comparisonStatus: "NOT_AVAILABLE" } };
    return { status: "REAL", source, value: { current, previous, growthPercent: Number(((current - previous) / previous * 100).toFixed(2)), comparisonStatus: "AVAILABLE" } };
  }

  private async rowsFor(table: string, ids: string[], period: AdminPeriod | undefined, column: string, extra: string): Promise<Row[]> {
    if (ids.length === 0) return [];
    const values: unknown[] = [...ids]; const clauses = [`business_id IN (${ids.map((_, index) => `$${index + 1}`).join(",")})`, extra];
    if (period?.from !== undefined) { values.push(period.from); clauses.push(`${column}>=$${values.length}`); }
    if (period?.to !== undefined) { values.push(period.to); clauses.push(`${column}<$${values.length}`); }
    return (await this.database.query<Row>(`SELECT * FROM ${table} WHERE ${clauses.join(" AND ")}`, values)).rows;
  }

  private async issueSummaries(input: PlatformFilters, businesses: BusinessRow[]): Promise<PlatformIssue[]> {
    const events = (await this.issueEvents(input, businesses)).filter((row) => input.issueType === undefined || row.issue_type === input.issueType);
    const grouped = new Map<string, Row[]>();
    for (const event of events) { const list = grouped.get(String(event.issue_type)) ?? []; list.push(event); grouped.set(String(event.issue_type), list); }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([type, group]) => {
      const affected = new Set(group.map((item) => String(item.business_id)));
      const byPlan = [AdminPlan.BASIC, AdminPlan.INTERMEDIATE, AdminPlan.ADVANCED].map((plan) => { const planRows = group.filter((item) => item.plan === plan); return { plan, occurrences: planRows.length, businessesAffected: new Set(planRows.map((item) => String(item.business_id))).size }; }).filter((item) => item.occurrences > 0);
      return { type, occurrences: group.length, businessesAffected: affected.size, affectedPercent: businesses.length === 0 ? 0 : Number((affected.size / businesses.length * 100).toFixed(2)), byPlan, period: input.period ?? {} };
    });
  }

  private async issueEvents(input: PlatformFilters, businesses: BusinessRow[]): Promise<Row[]> {
    const ids = businesses.map((item) => item.id);
    if (ids.length === 0) return [];
    const values: unknown[] = [...ids];
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
    const period = (column: string): string => { const clauses: string[] = []; if (input.period?.from !== undefined) { values.push(input.period.from); clauses.push(`${column}>=$${values.length}`); } if (input.period?.to !== undefined) { values.push(input.period.to); clauses.push(`${column}<$${values.length}`); } return clauses.length === 0 ? "TRUE" : clauses.join(" AND "); };
    const result = await this.database.query<Row>(`SELECT d.business_id,d.status AS issue_source,d.updated_at AS occurred_at,CASE WHEN d.status='FAILED_RETRYABLE' THEN 'DELIVERY_FAILED_RETRYABLE' WHEN d.status='FAILED_FINAL' THEN 'DELIVERY_FAILED_FINAL' ELSE 'DELIVERY_RETRY' END AS issue_type,p.plan FROM outbound_deliveries d LEFT JOIN business_plan_assignments p ON p.business_id=d.business_id AND p.status='ACTIVE' WHERE d.business_id IN (${placeholders}) AND (${period("d.updated_at")}) AND (d.status IN ('FAILED_RETRYABLE','FAILED_FINAL') OR d.attempts>1)
      UNION ALL SELECT s.business_id,s.availability,s.checked_at,CASE WHEN s.source='provider-unavailable' THEN 'PROVIDER_UNAVAILABLE' ELSE 'STOCK_UNKNOWN' END,p.plan FROM stock_checks s LEFT JOIN business_plan_assignments p ON p.business_id=s.business_id AND p.status='ACTIVE' WHERE s.business_id IN (${placeholders}) AND (${period("s.checked_at")}) AND (s.availability='UNKNOWN' OR s.source='provider-unavailable')
      UNION ALL SELECT h.business_id,h.event_type,h.occurred_at,'ASSISTANT_'||h.event_type,p.plan FROM assistant_health_events h LEFT JOIN business_plan_assignments p ON p.business_id=h.business_id AND p.status='ACTIVE' WHERE h.business_id IN (${placeholders}) AND (${period("h.occurred_at")})`, values);
    return result.rows;
  }

  private async count(table: string, column: string, ids: string[], period: AdminPeriod | undefined, extra = "TRUE"): Promise<number> {
    if (ids.length === 0) return 0;
    const values: unknown[] = [...ids]; const clauses = [`business_id IN (${ids.map((_, index) => `$${index + 1}`).join(",")})`, extra];
    if (period?.from !== undefined) { values.push(period.from); clauses.push(`${column}>=$${values.length}`); }
    if (period?.to !== undefined) { values.push(period.to); clauses.push(`${column}<$${values.length}`); }
    const result = await this.database.query<Row>(`SELECT COUNT(*) AS count FROM ${table} WHERE ${clauses.join(" AND ")}`, values);
    return Number(result.rows[0]?.count ?? 0);
  }

  private async countAttempts(ids: string[], period: AdminPeriod | undefined): Promise<number> {
    if (ids.length === 0) return 0;
    const values: unknown[] = [...ids]; const clauses = [`business_id IN (${ids.map((_, index) => `$${index + 1}`).join(",")})`];
    if (period?.from !== undefined) { values.push(period.from); clauses.push(`updated_at>=$${values.length}`); }
    if (period?.to !== undefined) { values.push(period.to); clauses.push(`updated_at<$${values.length}`); }
    const result = await this.database.query<Row>(`SELECT COALESCE(SUM(GREATEST(attempts-1,0)),0) AS retries FROM outbound_deliveries WHERE ${clauses.join(" AND ")}`, values);
    return Number(result.rows[0]?.retries ?? 0);
  }
}

function validPlan(value: string): AdminPlanType { if (Object.values(AdminPlan).includes(value as AdminPlanType)) return value as AdminPlanType; throw new Error("Invalid business plan"); }
function inPeriod(value: string, period: AdminPeriod | undefined): boolean { return (period?.from === undefined || value >= period.from) && (period?.to === undefined || value < period.to); }
