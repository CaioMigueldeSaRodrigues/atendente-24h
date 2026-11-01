import assert from "node:assert/strict";
import test from "node:test";
import { createLogger, errorFields } from "../../src/infrastructure/logger.js";

test("the logger writes one JSON line with level, event, time and the fields", () => {
  const lines: string[] = [];
  createLogger((line) => lines.push(line), () => "2026-01-01T00:00:00.000Z").warn("HTTP 500", { requestId: "abc", status: 500, retry: false, skipped: undefined });
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!), { level: "warn", event: "HTTP 500", time: "2026-01-01T00:00:00.000Z", requestId: "abc", status: 500, retry: false });
});

test("a field that could carry personal content is replaced and the reserved keys cannot be overridden", () => {
  const lines: string[] = [];
  createLogger((line) => lines.push(line), () => "t").info("event", { messageContent: "meu telefone 5592999990000", phone: "5592999990000", token: "abc", level: "debug", time: "x" });
  const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.deepEqual(entry, { level: "info", event: "event", time: "t", messageContent: "[omitted]", phone: "[omitted]", token: "[omitted]" });
  assert.equal(lines[0]!.includes("5592999990000"), false);
});

test("a failing writer never throws into the caller", () => {
  assert.doesNotThrow(() => createLogger(() => { throw new Error("disk full"); }).error("event"));
});

test("error fields carry the class name and a short code, never the message", () => {
  const driver = Object.assign(new Error("password authentication failed for user atendente at 10.0.0.5"), { code: "28P01" });
  assert.deepEqual(errorFields(driver), { errorName: "Error", errorCode: "28P01" });
  assert.deepEqual(errorFields(new TypeError("x")), { errorName: "TypeError" });
  assert.deepEqual(errorFields("cliente 5592999990000"), { errorName: "NonError" });
  assert.deepEqual(errorFields(Object.assign(new Error("x"), { code: "texto com espaços e dados" })), { errorName: "Error" });
});
