import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { EvolutionGoTextSender } from "../../src/channels/whatsapp/evolution-go-text-sender.js";

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
    response.end("{}");
  }, async (baseUrl) => {
    await new EvolutionGoTextSender({ baseUrl, instanceToken: token }).sendText({ recipientJid, content });
  });
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
