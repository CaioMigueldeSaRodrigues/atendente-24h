import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { EVOLUTION_GO_SEND_TIMEOUT_MS, EvolutionGoTextSender } from "../../src/channels/whatsapp/evolution-go-text-sender.js";

const token = "synthetic-private-token";
const content = "synthetic private reply";
const recipientJid = "15551234567@s.whatsapp.net";

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("sends text with the exact Evolution Go request", async () => {
  await withServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/send/text");
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers.apikey, token);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), {
      number: recipientJid,
      text: content,
      formatJid: false,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: { Info: { ID: "provider-message-synthetic" } } }));
  }, async (baseUrl) => {
    assert.deepEqual(await new EvolutionGoTextSender({ baseUrl, instanceToken: token }).sendText({ recipientJid, content }), { providerMessageId: "provider-message-synthetic" });
  });
});

test("the provider formats only a number marked for it", async () => {
  const bodies: unknown[] = [];
  const sender = new EvolutionGoTextSender({
    baseUrl: "https://evolution.example",
    instanceToken: token,
    fetch: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ data: { Info: { ID: "provider-id" } } }); },
  });
  await sender.sendText({ recipientJid: "5592999991234", content, formatJid: true });
  await sender.sendText({ recipientJid, content });
  assert.deepEqual(bodies, [
    { number: "5592999991234", text: content, formatJid: true },
    { number: recipientJid, text: content, formatJid: false },
  ]);
});

test("rejects empty configuration and message fields", async () => {
  assert.throws(() => new EvolutionGoTextSender({ baseUrl: " ", instanceToken: token }));
  assert.throws(() => new EvolutionGoTextSender({ baseUrl: "http://localhost", instanceToken: " " }));
  const sender = new EvolutionGoTextSender({
    baseUrl: "http://localhost",
    instanceToken: token,
    fetch: async () => { throw new Error("fetch must not be called"); },
  });
  await assert.rejects(sender.sendText({ recipientJid: " ", content }), /input is invalid/);
  await assert.rejects(sender.sendText({ recipientJid, content: "" }), /input is invalid/);
});

test("uses a safe generic error for HTTP and invalid JSON responses", async () => {
  for (const responseBody of ["sensitive server response", "not-json"]) {
    await withServer((_request, response) => {
      response.writeHead(responseBody === "not-json" ? 200 : 500, { "Content-Type": "text/plain" });
      response.end(responseBody);
    }, async (baseUrl) => {
      const sender = new EvolutionGoTextSender({ baseUrl, instanceToken: token });
      await assert.rejects(sender.sendText({ recipientJid, content }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(token), false);
        assert.equal(error.message.includes(content), false);
        assert.equal(error.message.includes(responseBody), false);
        assert.equal(error.message, "Evolution Go text message could not be sent");
        return true;
      });
    });
  }
});

test("requires HTTPS for hosts with a dot, except loopback", () => {
  for (const baseUrl of ["http://evolution.example", "http://10.0.0.5:8080", "ftp://evolution.example", "not a url"]) {
    assert.throws(() => new EvolutionGoTextSender({ baseUrl, instanceToken: token }), { message: "Evolution Go sender configuration is invalid" });
  }
  for (const baseUrl of ["https://evolution.example", "http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080", "http://evolution:8080"]) {
    assert.ok(new EvolutionGoTextSender({ baseUrl, instanceToken: token }));
  }
});

test("bounds the provider call with a 10 second deadline", async () => {
  let signal: AbortSignal | undefined;
  const sender = new EvolutionGoTextSender({
    baseUrl: "https://evolution.example",
    instanceToken: token,
    fetch: async (_url, init) => { signal = init?.signal ?? undefined; return Response.json({ data: { Info: { ID: "provider-id" } } }); },
  });
  await sender.sendText({ recipientJid, content });
  assert.ok(signal instanceof AbortSignal);
  assert.equal(EVOLUTION_GO_SEND_TIMEOUT_MS, 10_000);
});
