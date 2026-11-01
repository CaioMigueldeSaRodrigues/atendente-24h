export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | undefined>;
export type Logger = { [level in LogLevel]: (event: string, fields?: LogFields) => void };

const MAX_FIELD_CHARS = 200;
// Last line of defense: callers must not pass these, and if one does the value never reaches the log.
const SENSITIVE_FIELD = /message|content|body|text|phone|jid|token|secret|password|authorization|cookie|email/i;
const SAFE_ERROR_CODE = /^[A-Za-z0-9_.-]{1,40}$/;

// One JSON object per line on stdout, ready for `docker compose logs`.
export function createLogger(write: (line: string) => void = (line) => { process.stdout.write(`${line}\n`); }, now: () => string = () => new Date().toISOString()): Logger {
  const emit = (level: LogLevel) => (event: string, fields: LogFields = {}): void => {
    const safe: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || key === "level" || key === "event" || key === "time") continue;
      safe[key] = SENSITIVE_FIELD.test(key) ? "[omitted]" : typeof value === "string" ? value.slice(0, MAX_FIELD_CHARS) : value;
    }
    try {
      write(JSON.stringify({ level, event: event.slice(0, MAX_FIELD_CHARS), time: now(), ...safe }));
    } catch {
      // Logging must never change behavior.
    }
  };
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

// Only the class name and a short code (Postgres SQLSTATE, Node errno): the message can carry driver or provider data.
export function errorFields(error: unknown): { errorName: string; errorCode?: string } {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return {
    errorName: error instanceof Error && SAFE_ERROR_CODE.test(error.name) ? error.name : "NonError",
    ...(typeof code === "string" && SAFE_ERROR_CODE.test(code) ? { errorCode: code } : {}),
  };
}
