import type { AdminPeriod } from "./admin-read-model.js";
import type { Channel } from "./domain/enums.js";
import { CommercialEventType } from "./domain/enums.js";

export type AdminDemandFilters = {
  businessId: string;
  period?: AdminPeriod;
  channel?: Channel;
  serviceItem?: string;
  brand?: string;
  model?: string;
  year?: number;
};

export type AdminDemandQuoteRow = {
  quoteId: string;
  requestedAt: string;
  requestDescription: string;
  brand?: string;
  model?: string;
  year?: number;
  eventType?: string;
  delivered?: boolean;
};

export type AdminDemandCount = { name: string; quantity: number };
export type AdminDemandServiceCount = AdminDemandCount & {
  requested: number;
  responded: number;
  published: number;
  delivered: number;
};
export type AdminDemandModelCount = { brand: string; model: string; quantity: number };
export type AdminDemandYearCount = { year: number; quantity: number };
export type AdminDemandTimelinePoint = { period: string; quantity: number };

export type AdminDemand = {
  businessId: string;
  period: AdminPeriod;
  channel?: Channel;
  services: AdminDemandServiceCount[];
  brands: AdminDemandCount[];
  models: AdminDemandModelCount[];
  years: AdminDemandYearCount[];
  timeline: AdminDemandTimelinePoint[];
  quotes: { requested: number; responded: number; published: number };
};

export function normalizeDemandText(value: string | undefined): { key: string; label: string } | undefined {
  if (value === undefined) return undefined;
  const label = value.trim().replace(/\s+/g, " ");
  if (label === "") return undefined;
  return { key: label.toLocaleLowerCase("pt-BR"), label };
}

function increment(map: Map<string, { label: string; quantity: number }>, value: string | undefined): void {
  const normalized = normalizeDemandText(value);
  if (normalized === undefined) return;
  const current = map.get(normalized.key);
  if (current === undefined) map.set(normalized.key, { label: normalized.label, quantity: 1 });
  else current.quantity += 1;
}

function sortedCounts(map: Map<string, { label: string; quantity: number }>): AdminDemandCount[] {
  return [...map.values()]
    .sort((left, right) => right.quantity - left.quantity || left.label.localeCompare(right.label, "pt-BR"))
    .map(({ label: name, quantity }) => ({ name, quantity }));
}

function requestedPeriod(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

export function buildAdminDemand(input: AdminDemandFilters, rows: readonly AdminDemandQuoteRow[]): AdminDemand {
  const quotes = new Map<string, AdminDemandQuoteRow & { responded: boolean; published: boolean }>();
  for (const row of rows) {
    const quote = quotes.get(row.quoteId);
    if (quote === undefined) {
      quotes.set(row.quoteId, { ...row, delivered: row.delivered === true, responded: row.eventType === CommercialEventType.QUOTE_RESPONDED, published: row.eventType === CommercialEventType.QUOTE_PUBLISHED });
    } else {
      quote.responded ||= row.eventType === CommercialEventType.QUOTE_RESPONDED;
      quote.published ||= row.eventType === CommercialEventType.QUOTE_PUBLISHED;
      quote.delivered ||= row.delivered === true;
    }
  }

  const serviceCounts = new Map<string, AdminDemandServiceCount>();
  const brandCounts = new Map<string, { label: string; quantity: number }>();
  const modelCounts = new Map<string, { brand: string; model: string; quantity: number }>();
  const yearCounts = new Map<number, number>();
  const timelineCounts = new Map<string, number>();
  let responded = 0;
  let published = 0;

  for (const quote of quotes.values()) {
    const service = normalizeDemandText(quote.requestDescription);
    if (service !== undefined) {
      const current = serviceCounts.get(service.key) ?? { name: service.label, quantity: 0, requested: 0, responded: 0, published: 0, delivered: 0 };
      current.quantity += 1;
      current.requested += 1;
      if (quote.responded) current.responded += 1;
      if (quote.published) current.published += 1;
      if (quote.delivered) current.delivered += 1;
      serviceCounts.set(service.key, current);
    }
    const brand = normalizeDemandText(quote.brand);
    const model = normalizeDemandText(quote.model);
    if (brand !== undefined) {
      increment(brandCounts, brand.label);
      if (model !== undefined) {
        const key = `${brand.key}\u0000${model.key}`;
        const current = modelCounts.get(key);
        if (current === undefined) modelCounts.set(key, { brand: brand.label, model: model.label, quantity: 1 });
        else current.quantity += 1;
      }
    }
    if (quote.year !== undefined) yearCounts.set(quote.year, (yearCounts.get(quote.year) ?? 0) + 1);
    const period = requestedPeriod(quote.requestedAt);
    timelineCounts.set(period, (timelineCounts.get(period) ?? 0) + 1);
    if (quote.responded) responded += 1;
    if (quote.published) published += 1;
  }

  return {
    businessId: input.businessId,
    period: input.period ?? {},
    ...(input.channel === undefined ? {} : { channel: input.channel }),
    services: [...serviceCounts.values()].sort((left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name, "pt-BR")),
    brands: sortedCounts(brandCounts),
    models: [...modelCounts.values()].sort((left, right) => right.quantity - left.quantity || left.brand.localeCompare(right.brand, "pt-BR") || left.model.localeCompare(right.model, "pt-BR")),
    years: [...yearCounts.entries()].sort(([left], [right]) => left - right).map(([year, quantity]) => ({ year, quantity })),
    timeline: [...timelineCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([period, quantity]) => ({ period, quantity })),
    quotes: { requested: quotes.size, responded, published },
  };
}
