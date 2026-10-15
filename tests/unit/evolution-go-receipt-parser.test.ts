import assert from "node:assert/strict";
import test from "node:test";
import { parseEvolutionGoReceipt } from "../../src/channels/whatsapp/evolution-go-receipt-parser.js";

test("parses an Evolution Go 0.7.2 Delivered Receipt with raw empty Type", () => {
  assert.deepEqual(parseEvolutionGoReceipt({
    event: "Receipt",
    instanceName: "instance-synthetic",
    state: "Delivered",
    data: {
      MessageIDs: ["provider-message-synthetic"],
      Type: "",
      Timestamp: "2026-01-02T03:04:05.000Z",
      Chat: "masked@s.whatsapp.net",
    },
  }), {
    instanceName: "instance-synthetic",
    providerMessageId: "provider-message-synthetic",
    status: "DELIVERED",
    occurredAt: "2026-01-02T03:04:05.000Z",
  });
});

test("parses an Evolution Go 0.7.2 Read Receipt with raw lowercase Type", () => {
  assert.deepEqual(parseEvolutionGoReceipt({
    event: "Receipt",
    instanceName: "instance-synthetic",
    state: "Read",
    data: {
      MessageIDs: ["provider-message-synthetic"],
      Type: "read",
      Timestamp: "2026-01-02T03:04:05.000Z",
      Chat: "masked@s.whatsapp.net",
    },
  }), {
    instanceName: "instance-synthetic",
    providerMessageId: "provider-message-synthetic",
    status: "READ",
    occurredAt: "2026-01-02T03:04:05.000Z",
  });
});

test("ignores ReadSelf and unknown Evolution Go Receipt states", () => {
  const base = {
    event: "Receipt",
    instanceName: "instance-synthetic",
    data: {
      MessageIDs: ["provider-message-synthetic"],
      Timestamp: "2026-01-02T03:04:05.000Z",
      Chat: "masked@s.whatsapp.net",
    },
  };
  assert.equal(parseEvolutionGoReceipt({ ...base, state: "ReadSelf", data: { ...base.data, Type: "read-self" } }), null);
  assert.equal(parseEvolutionGoReceipt({ ...base, state: "Played", data: { ...base.data, Type: "played" } }), null);
  assert.equal(parseEvolutionGoReceipt({ ...base, data: { ...base.data, Type: "Delivered" } }), null);
});
