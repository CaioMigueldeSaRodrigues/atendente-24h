export const LLM_SENDER_MESSAGE_LIMIT = 20;
export const LLM_SENDER_WINDOW_MS = 5 * 60 * 1000;
export const LLM_SENDER_DAILY_MESSAGE_LIMIT = 200;
export const LLM_DAILY_CALLS_PER_BUSINESS_DEFAULT = 2000;
const LLM_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type LlmGuardOptions = {
  now: () => string;
  dailyCallsPerBusiness?: number;
  // Absent where ai_usage_events does not exist (SQLite): only the sender limit applies.
  countCallsSince?: (businessId: string, since: string) => Promise<number>;
};

// ponytail: sender windows live in this process; N processes allow N×20 (and N×200 a day) and a restart resets them. Move to a shared store when the runtime scales out.
// ponytail: the daily ceiling counts finished calls in a rolling 24 h, so calls in flight can overshoot by the concurrency level. Reserve before calling if that overshoot ever costs real money.
export class LlmGuard {
  private readonly recentBySender = new Map<string, number[]>();

  constructor(private readonly options: LlmGuardOptions) {}

  async allow(businessId: string, senderKey: string): Promise<boolean> {
    const nowMs = Date.parse(this.options.now());
    const cutoff = nowMs - LLM_SENDER_WINDOW_MS;
    const dayCutoff = nowMs - LLM_DAILY_WINDOW_MS;
    for (const [key, times] of this.recentBySender) {
      if (times.at(-1)! <= dayCutoff) this.recentBySender.delete(key);
    }
    const key = JSON.stringify([businessId, senderKey]);
    const times = (this.recentBySender.get(key) ?? []).filter((time) => time > dayCutoff);
    if (times.length >= LLM_SENDER_DAILY_MESSAGE_LIMIT || times.filter((time) => time > cutoff).length >= LLM_SENDER_MESSAGE_LIMIT) return false;
    // Registered before the await below so concurrent messages count against the limit.
    this.recentBySender.set(key, [...times, nowMs]);

    if (this.options.countCallsSince === undefined) return true;
    const since = new Date(nowMs - LLM_DAILY_WINDOW_MS).toISOString();
    const calls = await this.options.countCallsSince(businessId, since);
    return calls < (this.options.dailyCallsPerBusiness ?? LLM_DAILY_CALLS_PER_BUSINESS_DEFAULT);
  }
}
