import type { AdminPeriod } from "./admin-read-model.js";
import type { AdminPlan } from "./admin-plan-entitlement.js";

export type PlatformFilters = {
  period?: AdminPeriod;
  plan?: AdminPlan;
  businessId?: string;
  status?: "ACTIVE" | "INACTIVE";
  issueType?: string;
};

export type MetricStatus = "REAL" | "STRUCTURE" | "NOT_AVAILABLE";
export type PlatformMetric<T> = { status: MetricStatus; value?: T; source: string; limitation?: string };
export type PlatformQuoteBenchmarkStatus = "AVAILABLE" | "INSUFFICIENT_DATA";

export type PlatformQuoteBenchmark = {
  lowerReferenceCents: number | null;
  observedAverageCents: number | null;
  medianCents: number | null;
  upperReferenceCents: number | null;
  totalAuthorizedCents: number;
  globalAverageCents: number | null;
  businessesWithQuoteData: number;
  quotesWithValue: number;
  currency: "BRL";
  benchmarkStatus: PlatformQuoteBenchmarkStatus;
};

export type PlatformOperationalMetrics = {
  activeAttendants: PlatformMetric<{ count: number }>;
  requests: PlatformMetric<{ total: number }>;
  pendingRequests: PlatformMetric<{ total: number; underOneHour: number; betweenOneAndTwoHours: number; overTwoHours: number }>;
  abandonmentByDelay: PlatformMetric<never>;
  quotes: PlatformMetric<PlatformQuoteBenchmark>;
  segmentAdoption: PlatformMetric<Array<{ segment: string; businesses: number; byPlan: Array<{ plan: AdminPlan; businesses: number }>; sharePercent: number }>>;
  planChurnBySegment: PlatformMetric<never>;
  satisfaction: PlatformMetric<never>;
  attendanceGrowth: PlatformMetric<{ current: number; previous: number; growthPercent?: number; comparisonStatus: "AVAILABLE" | "NOT_AVAILABLE" }>;
  efficiency: PlatformMetric<{ attended: number; received: number; efficiencyPercent?: number }>;
};

export type PlatformPlanSummary = {
  plan: AdminPlan;
  businesses: number;
  sharePercent: number;
  conversations: number;
  quoteRequests: number;
  deliveriesFailed: number;
  retries: number;
  stockChecks: number;
  stockUnknown: number;
};

export type PlatformOverview = {
  period: AdminPeriod;
  businesses: { total: number; active: number; inactive: number; newInPeriod: number };
  plans: PlatformPlanSummary[];
  mostAdoptedPlan: AdminPlan | null;
  geography: { status: "NOT_AVAILABLE"; reason: string; regions: never[] };
  metrics: PlatformOperationalMetrics;
};

export type PlatformIssue = {
  type: string;
  occurrences: number;
  businessesAffected: number;
  affectedPercent: number;
  byPlan: Array<{ plan: AdminPlan; occurrences: number; businessesAffected: number }>;
  period: AdminPeriod;
};

export type PlatformHealth = {
  period: AdminPeriod;
  status: "HEALTHY" | "ATTENTION";
  incidents: number;
  businessesAffected: number;
  issues: PlatformIssue[];
  pendingRequests: PlatformOverview["metrics"]["pendingRequests"];
};

export type PlatformQueryService = {
  getOverview(input: PlatformFilters): Promise<PlatformOverview>;
  getPlans(input: PlatformFilters): Promise<PlatformPlanSummary[]>;
  getHealth(input: PlatformFilters): Promise<PlatformHealth>;
  getIssues(input: PlatformFilters): Promise<PlatformIssue[]>;
};

export type SuperAdminAuthorizer = {
  isAuthorized(): Promise<boolean>;
};

/**
 * Aggregates quote values in two stages: first a ticket per business, then the
 * benchmark over those business tickets. References are the lower and upper
 * values in the sorted business-ticket sample, not individual quotes.
 */
export function aggregatePlatformQuoteBenchmark(rows: ReadonlyArray<{ businessId: string; amountCents: number }>): PlatformQuoteBenchmark {
  const byBusiness = new Map<string, { totalCents: number; quotesWithValue: number }>();
  let totalAuthorizedCents = 0;
  let quotesWithValue = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.amountCents)) continue;
    const current = byBusiness.get(row.businessId) ?? { totalCents: 0, quotesWithValue: 0 };
    current.totalCents += row.amountCents;
    current.quotesWithValue += 1;
    byBusiness.set(row.businessId, current);
    totalAuthorizedCents += row.amountCents;
    quotesWithValue += 1;
  }

  const tickets = [...byBusiness.values()].map((item) => item.totalCents / item.quotesWithValue).sort((left, right) => left - right);
  const globalAverageCents = quotesWithValue === 0 ? null : Math.round(totalAuthorizedCents / quotesWithValue);
  const benchmarkStatus: PlatformQuoteBenchmarkStatus = tickets.length >= 2 ? "AVAILABLE" : "INSUFFICIENT_DATA";
  const observedAverageCents = tickets.length === 0 ? null : Math.round(tickets.reduce((sum, value) => sum + value, 0) / tickets.length);
  const medianCents = tickets.length === 0 ? null : Math.round(tickets.length % 2 === 1
    ? tickets[Math.floor(tickets.length / 2)]!
    : (tickets[tickets.length / 2 - 1]! + tickets[tickets.length / 2]!) / 2);

  return {
    lowerReferenceCents: benchmarkStatus === "AVAILABLE" ? Math.round(tickets[0]!) : null,
    observedAverageCents,
    medianCents,
    upperReferenceCents: benchmarkStatus === "AVAILABLE" ? Math.round(tickets[tickets.length - 1]!) : null,
    totalAuthorizedCents,
    globalAverageCents,
    businessesWithQuoteData: tickets.length,
    quotesWithValue,
    currency: "BRL",
    benchmarkStatus,
  };
}
