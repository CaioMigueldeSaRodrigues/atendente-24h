export type OpeningInterval = { open: string; close: string };
// Keys are the weekdays 0-6 (0 = Sunday); a missing or empty day means closed.
export type OpeningHours = Partial<Record<number, OpeningInterval[]>>;

export type BusinessProfile = {
  businessId: string;
  address?: string;
  phone?: string;
  // Private number that receives the "customer waiting" notice; it never reaches the LLM.
  notifyPhone?: string;
  openingHours: OpeningHours;
  services: string[];
  paymentMethods: string[];
  notes?: string;
  updatedAt: string;
};

export type BusinessProfileInput = Omit<BusinessProfile, "businessId" | "updatedAt">;

export type BusinessFacts = {
  address?: string;
  phone?: string;
  openingHours?: Record<string, string>;
  services: string[];
  paymentMethods: string[];
  notes?: string;
};

export interface BusinessProfileRepository {
  findByBusinessId(businessId: string): Promise<BusinessProfile | null>;
  save(profile: BusinessProfile): Promise<void>;
}

export class BusinessProfileError extends Error {}

export const OPENING_NOTICE_PREFIX = "Estamos fora do horário de atendimento.";
export const OPENING_NOTICE_INTERVAL_MS = 12 * 60 * 60 * 1000;

const WEEKDAY_NAMES = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"] as const;
// ponytail: an interval never crosses midnight (open < close); a workshop open past 23:59 needs two days. Add when a pilot needs it.
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_LIST_ITEMS = 50;
const MAX_INTERVALS_PER_DAY = 4;
// Prices never reach the facts: the quote flow is the only place that states one.
const PRICE = /R\s*\$|\breais\b|\b\d{1,3}(?:\.\d{3})*,\d{2}\b/i;

export function parseBusinessProfileInput(value: unknown): BusinessProfileInput {
  if (!isRecord(value)) throw new BusinessProfileError("Perfil inválido.");
  const address = optionalText(value.address, "Endereço", 300);
  const phone = optionalText(value.phone, "Telefone", 40);
  const notes = optionalText(value.notes, "Observações", 1000);
  const notifyPhone = optionalNotifyPhone(value.notifyPhone);
  return {
    ...(address === undefined ? {} : { address }),
    ...(phone === undefined ? {} : { phone }),
    ...(notifyPhone === undefined ? {} : { notifyPhone }),
    openingHours: parseOpeningHours(value.openingHours),
    services: textList(value.services, "Serviços"),
    paymentMethods: textList(value.paymentMethods, "Formas de pagamento"),
    ...(notes === undefined ? {} : { notes }),
  };
}

export function emptyBusinessProfile(businessId: string): Omit<BusinessProfile, "updatedAt"> {
  return { businessId, openingHours: {}, services: [], paymentMethods: [] };
}

export function buildBusinessFacts(profile: BusinessProfile): BusinessFacts {
  return {
    ...(profile.address === undefined ? {} : { address: profile.address }),
    ...(profile.phone === undefined ? {} : { phone: profile.phone }),
    ...(hasOpeningHours(profile) ? { openingHours: Object.fromEntries(WEEKDAY_NAMES.map((name, day) => [name, describeDay(profile.openingHours[day])])) } : {}),
    services: profile.services,
    paymentMethods: profile.paymentMethods,
    ...(profile.notes === undefined ? {} : { notes: profile.notes }),
  };
}

export function hasOpeningHours(profile: BusinessProfile): boolean {
  return Object.values(profile.openingHours).some((day) => day !== undefined && day.length > 0);
}

export function isOpenAt(profile: BusinessProfile, instant: Date | string, timezone: string): boolean {
  const { weekday, minutes } = localTime(instant, timezone);
  return (profile.openingHours[weekday] ?? []).some(({ open, close }) => toMinutes(open) <= minutes && minutes < toMinutes(close));
}

// The first opening strictly after the instant, looking one full week ahead; undefined when no hours are registered.
export function nextOpening(profile: BusinessProfile, instant: Date | string, timezone: string): { daysAhead: number; weekday: number; time: string } | undefined {
  const { weekday, minutes } = localTime(instant, timezone);
  for (let daysAhead = 0; daysAhead <= 7; daysAhead += 1) {
    const day = (weekday + daysAhead) % 7;
    const next = (profile.openingHours[day] ?? [])
      .map(({ open }) => open)
      .filter((open) => daysAhead > 0 || toMinutes(open) > minutes)
      .sort()[0];
    if (next !== undefined) return { daysAhead, weekday: day, time: next };
  }
  return undefined;
}

// One line telling when the workshop opens again; undefined while open or when no hours are registered.
export function closedNotice(profile: BusinessProfile, instant: Date | string, timezone: string): string | undefined {
  if (!hasOpeningHours(profile) || isOpenAt(profile, instant, timezone)) return undefined;
  const next = nextOpening(profile, instant, timezone);
  if (next === undefined) return undefined;
  const when = next.daysAhead === 0 ? "hoje" : next.daysAhead === 1 ? "amanhã" : `na ${WEEKDAY_NAMES[next.weekday]}`;
  return `${OPENING_NOTICE_PREFIX} Voltamos ${when} às ${next.time}.`;
}

export function formatLocalDateTime(instant: Date | string, timezone: string): string {
  const parts = dateParts(instant, timezone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${WEEKDAY_NAMES[localTime(instant, timezone).weekday]}, ${timezone})`;
}

function describeDay(intervals: OpeningInterval[] | undefined): string {
  return intervals === undefined || intervals.length === 0 ? "fechado" : intervals.map(({ open, close }) => `${open}-${close}`).join(", ");
}

function parseOpeningHours(value: unknown): OpeningHours {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new BusinessProfileError("Horários inválidos.");
  const hours: OpeningHours = {};
  for (const [key, intervals] of Object.entries(value)) {
    if (!/^[0-6]$/.test(key) || !Array.isArray(intervals) || intervals.length > MAX_INTERVALS_PER_DAY) throw new BusinessProfileError("Horários inválidos.");
    const parsed = intervals.map((interval): OpeningInterval => {
      if (!isRecord(interval) || typeof interval.open !== "string" || typeof interval.close !== "string" ||
        !TIME.test(interval.open) || !TIME.test(interval.close) || interval.open >= interval.close) {
        throw new BusinessProfileError("Horários inválidos: use HH:MM e abertura antes do fechamento.");
      }
      return { open: interval.open, close: interval.close };
    });
    if (parsed.length > 0) hours[Number(key)] = parsed.sort((a, b) => a.open.localeCompare(b.open));
  }
  return hours;
}

function textList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new BusinessProfileError(`${label} inválidos.`);
  return value.map((item) => cleanText(item, label, 100)).filter((item) => item !== "");
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = cleanText(value, label, max);
  return text === "" ? undefined : text;
}

function cleanText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length > max * 2) throw new BusinessProfileError(`${label} inválido.`);
  const text = value.trim();
  if (text.length > max) throw new BusinessProfileError(`${label} excede ${max} caracteres.`);
  if (PRICE.test(text)) throw new BusinessProfileError(`${label}: não informe preços; o valor sai pelo orçamento.`);
  return text;
}

function optionalNotifyPhone(value: unknown): string | undefined {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return undefined;
  if (typeof value !== "string") throw new BusinessProfileError("WhatsApp para avisos inválido.");
  const digits = value.replace(/\D/g, "");
  const full = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  if (!/^\d{12,15}$/.test(full)) throw new BusinessProfileError("WhatsApp para avisos inválido: informe DDD e número.");
  return full;
}

function dateParts(instant: Date | string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(typeof instant === "string" ? new Date(instant) : instant);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), weekday: part("weekday") };
}

function localTime(instant: Date | string, timezone: string): { weekday: number; minutes: number } {
  const { hour, minute, weekday } = dateParts(instant, timezone);
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday), minutes: Number(hour) * 60 + Number(minute) };
}

function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
