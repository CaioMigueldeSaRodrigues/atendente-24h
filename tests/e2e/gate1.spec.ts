import type { Page } from "@playwright/test";
import { test, expect, Harness, businessId, otherBusinessId, customerText, draftBody, moneyReply } from "./harness.js";
import { AdminPlan } from "../../src/core/admin-plan-entitlement.js";
import { LLM_FAILURE_REPLY, UNSUPPORTED_MESSAGE_REPLY } from "../../src/core/response-policy.js";

async function selectQuote(page: Page, gate: Harness) {
  await page.goto(gate.url + "/operator");
  await page.getByRole("button", { name: /João Açúcar/ }).click();
  const selectedQuote = page.locator('.quote-option[aria-current="true"]');
  const quoteId = await selectedQuote.getAttribute("data-quote-request-id");
  if (!quoteId) throw new Error("Selected quote has no id");
  const link = (await gate.db.query<{ sender_jid: string }>(
    "SELECT l.sender_jid FROM quote_requests q JOIN evolution_go_conversation_links l ON l.business_id=q.business_id AND l.conversation_id=q.conversation_id WHERE q.business_id=$1 AND q.id=$2",
    [businessId, quoteId],
  )).rows;
  expect(link).toHaveLength(1);
  const senderJid = link[0]!.sender_jid;
  const phone = /^([0-9]{4,})@s\.whatsapp\.net$/.exec(senderJid.trim())?.[1];
  if (!phone) throw new Error("Selected quote link has no synthetic WhatsApp sender");
  const contactLabel = `WhatsApp ${phone}`;
  await expect(selectedQuote).toContainText(contactLabel);
  await expect(page.locator("#conversation-history")).toContainText(customerText);
  await expect(page.locator(".detail-grid")).toContainText("Toyota");
  await expect(page.locator(".detail-grid")).toContainText(contactLabel);
  await expect(page.locator(".detail-grid")).toContainText("Corolla");
  await expect(page.locator(".detail-grid")).toContainText("Troca de óleo");
  const documentHtml = await page.evaluate(() => document.documentElement.outerHTML);
  // The operator needs the whole number to call back; the raw channel id still never reaches the page.
  expect(documentHtml).not.toContain(senderJid);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function clickResponse(page: Page, label: string, suffix: string) {
  const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(suffix));
  await page.getByRole("button", { name: label, exact: true }).click();
  return response;
}
async function refreshQueue(page: Page, isMobile: boolean) {
  const refreshButton = page.locator("#refresh-button");
  if (isMobile) await refreshButton.evaluate((button) => (button as HTMLButtonElement).click());
  else await refreshButton.click();
}
async function authorizeManual(page: Page, gate: Harness) {
  await selectQuote(page, gate);
  await page.getByLabel("Valor autorizado em reais").fill("282,00");
  expect((await clickResponse(page, "Autorizar", "/respond")).status()).toBe(200);
}
async function buildInBrowser(page: Page, gate: Harness) {
  await selectQuote(page, gate);
  await page.getByLabel("Produto", { exact: true }).fill("Óleo 5W30");
  await page.getByLabel("SKU", { exact: true }).fill("OIL-5W30");
  await page.getByLabel("Quantidade em litros", { exact: true }).fill("4");
  await page.getByLabel("Mão de obra", { exact: true }).fill("Troca de óleo");
  expect((await clickResponse(page, "Montar orçamento", "/draft")).status()).toBe(201);
  await expect(page.locator(".integrated-total")).toContainText("282,00");
  await expect(page.locator(".integrated-section:visible")).toHaveCount(2);
  await expect(page.locator(".integrated-section:visible").first()).toContainText("192,00");
  await expect(page.locator(".integrated-section:visible").last()).toContainText("90,00");
}
async function assertPublication(gate: Harness, quoteId: string, cents = 28200) {
  const quote = (await gate.db.query("SELECT * FROM quote_requests WHERE id=$1", [quoteId])).rows[0]!;
  expect(Number(quote.authorized_price_amount_cents)).toBe(cents);
  expect(quote.authorized_price_currency).toBe("BRL");
  const messages = (await gate.db.query("SELECT m.* FROM messages m JOIN outbound_deliveries o ON o.message_id=m.id AND o.business_id=m.business_id WHERE o.quote_request_id=$1", [quoteId])).rows;
  expect(messages).toHaveLength(1);
  expect(messages[0]!.content).toBe(moneyReply((cents / 100).toFixed(2).replace(".", ",")));
  const events = (await gate.db.query("SELECT * FROM commercial_events WHERE quote_request_id=$1 AND event_type='QUOTE_PUBLISHED'", [quoteId])).rows;
  expect(events).toHaveLength(1);
  expect(Number(events[0]!.amount_cents)).toBe(cents);
  const delivery = (await gate.db.query("SELECT * FROM outbound_deliveries WHERE quote_request_id=$1", [quoteId])).rows;
  expect(delivery).toHaveLength(1);
  expect(delivery[0]!.status).toBe("DELIVERED");
  const sent = gate.senderCalls.filter((call) => call.delivered && call.recipientJid === delivery[0]!.recipient_ref && call.content === messages[0]!.content);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.recipientJid).toBe(delivery[0]!.recipient_ref);
}

test("A01 authentication, invalid password, tenant and authenticated reload", async ({ gate, page }) => {
  expect((await gate.request("/operator", "GET", undefined, false)).status).toBe(401);
  expect((await fetch(gate.url + "/operator", { headers: { authorization: "Basic " + Buffer.from("wrong:wrong").toString("base64") } })).status).toBe(401);
  expect((await gate.request(`/v1/businesses/${otherBusinessId}/quotes/pending`)).status).toBe(404);
  expect((await page.goto(gate.url + "/operator"))!.status()).toBe(200);
  expect((await page.reload())!.status()).toBe(200);
  await expect(page.locator(".business-name")).toHaveText("Oficina Gate 1");
});

test("B01 client intake, UTF-8, missing fields and progressive customer/vehicle persistence", async ({ gate }) => {
  expect((await gate.request(gate.route("/conversations"), "POST", { channel: "WEB" }, false)).status).toBe(404);
  const created = await gate.request(gate.route("/conversations"), "POST", { channel: "WEB" });
  expect(created.status).toBe(201);
  const { conversationId } = await created.json() as { conversationId: string };
  const path = gate.route(`/conversations/${conversationId}/messages`);
  expect((await gate.request(path, "POST", { content: "Sem credencial" }, false)).status).toBe(404);
  expect(gate.interpreterCalls).toHaveLength(0);
  const normal = await gate.request(path, "POST", { content: "Olá <script>alert(1)</script> ação 🚗" });
  expect(normal.status).toBe(200);
  expect((await normal.json()).reply).toBe("Olá! Atendimento São José — ação, ç, ã, 🚗.");
  expect((await gate.request(path, "POST", { content: "Quero orçamento" })).status).toBe(200);
  expect((await gate.db.query("SELECT status FROM quote_requests")).rows[0]!.status).toBe("WAITING_INFORMATION");
  expect((await gate.request(path, "POST", { content: customerText })).status).toBe(200);
  expect((await gate.db.query("SELECT name FROM customers")).rows[0]!.name).toBe("João Açúcar");
  expect((await gate.db.query("SELECT model,year FROM vehicles")).rows[0]).toMatchObject({ model: "Corolla", year: 2020 });
  expect((await gate.db.query("SELECT status FROM quote_requests")).rows).toEqual([{ status: "WAITING_BUSINESS" }]);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM messages")).rows[0]!.n).toBe(6);
});

test("B02 empty text, invalid JSON, wrong content type, message limit and body limit", async ({ gate }) => {
  const created = await gate.request(gate.route("/conversations"), "POST", { channel: "WEB" });
  const { conversationId } = await created.json() as { conversationId: string };
  const path = gate.route(`/conversations/${conversationId}/messages`);
  expect((await gate.request(path, "POST", { content: " " })).status).toBe(400);
  expect((await fetch(gate.url + path, { method: "POST", headers: { "content-type": "application/json", authorization: gate.auth() }, body: "{" })).status).toBe(400);
  expect((await fetch(gate.url + path, { method: "POST", headers: { "content-type": "text/plain", authorization: gate.auth() }, body: JSON.stringify({ content: "x" }) })).status).toBe(415);
  expect((await fetch(gate.url + path, { method: "POST", headers: { "content-type": "application/json", authorization: gate.auth(), origin: "https://evil.example" }, body: JSON.stringify({ content: "x" }) })).status).toBe(403);
  expect((await gate.request(path, "POST", { content: "a".repeat(4000) })).status).toBe(200);
  const calls = gate.interpreterCalls.length;
  expect((await gate.request(path, "POST", { content: "a".repeat(4001) })).status).toBe(400);
  expect((await gate.request(path, "POST", { content: "a".repeat(1_048_577) })).status).toBe(413);
  expect(gate.interpreterCalls).toHaveLength(calls);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM messages")).rows[0]!.n).toBe(2);
});

test("C01 webhook token, instance, ignored events and exact persisted/sent output", async ({ gate }) => {
  const payload = gate.webhook("Olá São José 🚗");
  for (const altered of [{ ...payload, instanceToken: "invalid" }, { ...payload, instanceToken: undefined }, { ...payload, instanceName: "wrong" }]) expect((await gate.sendWebhook(altered)).status).toBe(401);
  const ownMessage = await gate.sendWebhook({ ...payload, data: { ...payload.data, Info: { ...payload.data.Info, IsFromMe: true } } });
  expect(ownMessage.status).toBe(202);
  expect((await ownMessage.json()).accepted).toBe(false);
  expect(gate.interpreterCalls).toHaveLength(0);
  const accepted = await gate.sendWebhook(payload);
  expect(accepted.status).toBe(202);
  expect(await accepted.json()).toEqual({ accepted: true });
  expect((await gate.sendWebhook(payload)).status).toBe(202);
  expect(gate.interpreterCalls).toEqual([payload.data.Message.conversation]);
  expect(gate.senderCalls).toHaveLength(1);
  const messages = (await gate.db.query("SELECT sender_type,content FROM messages ORDER BY created_at,id")).rows;
  expect(messages.find((m) => m.sender_type === "CUSTOMER")!.content).toBe(payload.data.Message.conversation);
  expect(messages.find((m) => m.sender_type === "ASSISTANT")!.content).toBe(gate.senderCalls[0]!.content);
  const image = gate.webhook("", undefined, payload.data.Info.Sender);
  const imageWebhook = { ...image, data: { ...image.data, Info: { ...image.data.Info, Type: "image" }, Message: {} } };
  expect((await gate.sendWebhook(imageWebhook)).status).toBe(202);
  expect((await gate.sendWebhook(imageWebhook)).status).toBe(202);
  expect(gate.interpreterCalls).toHaveLength(1);
  expect(gate.senderCalls.map((call) => call.content)).toEqual([messages.find((m) => m.sender_type === "ASSISTANT")!.content, UNSUPPORTED_MESSAGE_REPLY]);
});

test("C02 concurrent replay and sender retry reuse persisted interpreter result", async ({ gate }) => {
  const payload = gate.webhook("Olá");
  gate.senderFails = true;
  expect((await gate.sendWebhook(payload)).status).toBe(503);
  expect((await gate.db.query("SELECT status FROM evolution_go_webhook_receipts")).rows[0]!.status).toBe("processed");
  gate.senderFails = false;
  expect((await gate.sendWebhook(payload)).status).toBe(202);
  expect(gate.interpreterCalls).toHaveLength(1);
  expect(gate.senderCalls.filter((c) => c.delivered)).toHaveLength(1);
  const next = gate.webhook("Concorrente");
  const responses = await Promise.all([gate.sendWebhook(next), gate.sendWebhook(next)]);
  expect(responses.every((r) => [202, 503].includes(r.status))).toBe(true);
  expect(responses.some((r) => r.status === 202)).toBe(true);
  expect(gate.interpreterCalls.filter((c) => c === "Concorrente")).toHaveLength(1);
  expect(gate.senderCalls.filter((c) => c.delivered)).toHaveLength(2);
});

for (const failure of ["throw", "timeout"] as const) test(`D01-${failure} interpreter failure keeps the message, answers fixed text and hands off`, async ({ gate }) => {
  gate.interpreterMode = failure;
  const payload = gate.webhook();
  expect((await gate.sendWebhook(payload)).status).toBe(202);
  expect((await gate.db.query("SELECT sender_type,content FROM messages ORDER BY sender_type DESC")).rows).toEqual([{ sender_type: "CUSTOMER", content: customerText }, { sender_type: "ASSISTANT", content: LLM_FAILURE_REPLY }]);
  expect(gate.senderCalls.map((call) => call.content)).toEqual([LLM_FAILURE_REPLY]);
  expect((await gate.db.query("SELECT reason,status FROM human_handoffs")).rows).toEqual([{ reason: "AI_FAILURE", status: "REQUESTED" }]);
  expect((await gate.db.query("SELECT status FROM conversations")).rows).toEqual([{ status: "WAITING_HUMAN" }]);
  for (const table of ["vehicles", "opportunities", "quote_requests"]) expect((await gate.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n).toBe(0);
  // The only customer is the one WhatsApp itself identified: the phone of the sender, nothing the model said.
  expect((await gate.db.query("SELECT name,primary_phone FROM customers")).rows).toEqual([{ name: null, primary_phone: payload.data.Info.Sender.replace("@s.whatsapp.net", "") }]);
  gate.interpreterMode = "normal";
  expect((await gate.sendWebhook(payload)).status).toBe(202);
  expect(gate.interpreterCalls).toHaveLength(1);
  expect(gate.senderCalls.filter((call) => call.delivered)).toHaveLength(1);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM messages")).rows[0]!.n).toBe(2);
});

test("D02 requiresHuman is persisted and safe response reaches sender", async ({ gate }) => {
  expect((await gate.sendWebhook(gate.webhook("Quero atendente"))).status).toBe(202);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM human_handoffs")).rows[0]!.n).toBe(1);
  const assistant = (await gate.db.query("SELECT content FROM messages WHERE sender_type='ASSISTANT'")).rows[0]!;
  expect(gate.senderCalls[0]!.content).toBe(assistant.content);
});

test("E01 real queue, history, UTF-8, refresh and full browser reload", async ({ gate, page, isMobile }) => {
  await gate.intake();
  await selectQuote(page, gate);
  if (isMobile) await page.getByRole("button", { name: "Voltar para orçamentos" }).click();
  await page.getByRole("button", { name: /Atualizar/ }).click();
  if (isMobile) await page.getByRole("button", { name: /João Açúcar/ }).click();
  await expect(page.locator("#conversation-history")).toContainText("João Açúcar");
  await page.reload();
  await page.getByRole("button", { name: /João Açúcar/ }).click();
  await expect(page.locator(".detail-grid")).toContainText("XEi");
  await expect(page.getByRole("button", { name: "Autorizar e enviar", exact: true })).toHaveCount(0);
});

test("E02 selected conversation refreshes an assistant message persisted after opening", async ({ gate, page, isMobile }) => {
  const quote = await gate.intake();
  await page.goto(gate.url + "/operator");
  const selectedQuote = page.locator(".quote-option").first();
  await expect(selectedQuote).toBeVisible();
  await selectedQuote.click();
  await expect(selectedQuote).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#conversation-history .conversation-history")).toBeVisible();
  const content = "Resposta persistida depois da abertura";
  await gate.db.query("INSERT INTO messages(id,business_id,conversation_id,sender_type,channel,content,created_at) VALUES($1,$2,$3,'ASSISTANT','WHATSAPP',$4,$5)", ["assistant-after-open", businessId, quote.conversation_id, content, "2026-01-02T00:00:01.000Z"]);
  const refreshButton = page.locator("#refresh-button");
  if (isMobile) await refreshButton.evaluate((button) => (button as HTMLButtonElement).click());
  else await refreshButton.click();
  await expect(page.locator("#conversation-history")).toContainText(content);
  await expect(page.locator('.quote-option[aria-current="true"]')).toHaveCount(1);
});

test("E03 selection identity survives polling and publishes only the selected quote", async ({ gate, page, isMobile }) => {
  const quoteA = await gate.intake();
  await page.goto(gate.url + "/operator");
  const optionA = page.locator(`.quote-option[data-quote-request-id="${quoteA.id}"]`);
  await optionA.click();
  await expect(optionA).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".detail-content")).toHaveAttribute("data-quote-request-id", quoteA.id);

  expect((await gate.sendWebhook(gate.webhook(customerText, "00000000-0000-4000-8000-000000000002", "second-synthetic@s.whatsapp.net"))).status).toBe(202);
  const quoteB = ((await gate.db.query("SELECT id,conversation_id FROM quote_requests ORDER BY requested_at DESC,id DESC LIMIT 1")).rows[0]!) as { id: string; conversation_id: string };
  await refreshQueue(page, isMobile);
  await expect(page.locator(`.quote-option[data-quote-request-id="${quoteB.id}"]`)).toHaveCount(1);
  await expect(page.locator(`.quote-option[data-quote-request-id="${quoteA.id}"]`)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".detail-content")).toHaveAttribute("data-quote-request-id", quoteA.id);

  await page.getByLabel("Valor autorizado em reais").fill("282,00");
  expect((await clickResponse(page, "Autorizar", "/respond")).status()).toBe(200);
  expect((await clickResponse(page, "Enviar ao cliente", "/publish")).status()).toBe(200);
  await assertPublication(gate, quoteA.id);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM commercial_events WHERE quote_request_id=$1 AND event_type='QUOTE_PUBLISHED'", [quoteB.id])).rows[0]!.n).toBe(0);

  await page.locator(`.quote-option[data-quote-request-id="${quoteB.id}"]`).click();
  await expect(page.locator(".detail-content")).toHaveAttribute("data-quote-request-id", quoteB.id);
  await page.getByLabel("Valor autorizado em reais").fill("282,00");
  expect((await clickResponse(page, "Autorizar", "/respond")).status()).toBe(200);
  expect((await clickResponse(page, "Enviar ao cliente", "/publish")).status()).toBe(200);
  await assertPublication(gate, quoteB.id);
});

test("E04 stale selected quote blocks authorization until the queue is refreshed", async ({ gate, page, isMobile }) => {
  const quote = await gate.intake();
  await page.goto(gate.url + "/operator");
  await page.locator(`.quote-option[data-quote-request-id="${quote.id}"]`).click();
  let staleActionRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && (/\/respond$/.test(request.url()) || /\/publish$/.test(request.url()))) staleActionRequests++;
  });
  await gate.db.query("UPDATE quote_requests SET status='RESPONDED', authorized_price_amount_cents=$1, authorized_price_currency='BRL', responded_at=$2, updated_at=$2 WHERE id=$3 AND business_id=$4", [28200, "2026-01-02T00:00:01.000Z", quote.id, businessId]);
  await page.locator(".action-panel").evaluate((panel) => panel.setAttribute("data-quote-request-updated-at", "stale-revision"));
  await page.getByLabel("Valor autorizado em reais").fill("282,00");
  await page.getByRole("button", { name: "Autorizar", exact: true }).click();
  await expect(page.locator("#feedback")).toContainText("Atualize a fila");
  await expect(page.locator(".action-panel button[type=submit]")).toBeDisabled();
  expect(staleActionRequests).toBe(0);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM commercial_events WHERE quote_request_id=$1 AND event_type='QUOTE_PUBLISHED'", [quote.id])).rows[0]!.n).toBe(0);
  await refreshQueue(page, isMobile);
  await expect(page.locator(".action-panel button[type=submit]")).toBeEnabled();
});

test("E05 order changed during analysis: authorization is refused, panel reloads and the second attempt works", async ({ gate, page }) => {
  const quote = await gate.intake();
  await page.goto(gate.url + "/operator");
  await page.locator(`.quote-option[data-quote-request-id="${quote.id}"]`).click();
  await page.getByLabel("Valor autorizado em reais").fill("282,00");
  await gate.db.query("UPDATE quote_requests SET updated_at=$1 WHERE id=$2", ["2026-01-02T00:00:01.000Z", quote.id]);
  expect((await clickResponse(page, "Autorizar", "/respond")).status()).toBe(409);
  await expect(page.locator("#feedback")).toContainText("mudou");
  expect((await gate.db.query("SELECT authorized_price_amount_cents FROM quote_requests WHERE id=$1", [quote.id])).rows[0]!.authorized_price_amount_cents).toBeNull();
  await page.getByLabel("Valor autorizado em reais").fill("282,00");
  expect((await clickResponse(page, "Autorizar", "/respond")).status()).toBe(200);
});

test("F01 BASIC manual browser authorization, reload and exact financial delivery", async ({ gate, page }) => {
  const quote = await gate.intake();
  await authorizeManual(page, gate);
  expect(Number((await gate.db.query("SELECT authorized_price_amount_cents FROM quote_requests WHERE id=$1", [quote.id])).rows[0]!.authorized_price_amount_cents)).toBe(28200);
  await expect(page.getByRole("button", { name: "Enviar ao cliente", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /João Açúcar/ }).click();
  expect((await clickResponse(page, "Enviar ao cliente", "/publish")).status()).toBe(200);
  await assertPublication(gate, quote.id);
  expect(gate.inventoryCalls).toBe(0);
});

test("G01 double click and concurrent publish produce one financial delivery", async ({ gate, page }) => {
  const quote = await gate.intake();
  await authorizeManual(page, gate);
  await selectQuote(page, gate);
  const response = page.waitForResponse((r) => r.url().endsWith("/publish"));
  await page.getByRole("button", { name: "Enviar ao cliente", exact: true }).dblclick();
  expect((await response).status()).toBe(200);
  const responses = await Promise.all([gate.request(gate.route(`/quotes/${quote.id}/publish`), "POST"), gate.request(gate.route(`/quotes/${quote.id}/publish`), "POST")]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  await assertPublication(gate, quote.id);
});

test("G02 sender failure is human-readable and retry after reload succeeds once", async ({ gate, page }) => {
  const quote = await gate.intake();
  await authorizeManual(page, gate);
  await selectQuote(page, gate);
  gate.senderFails = true;
  await clickResponse(page, "Enviar ao cliente", "/publish");
  await expect(page.locator("#feedback")).toContainText(/não|Não/);
  await expect(page.getByRole("button", { name: "Enviar ao cliente", exact: true })).toBeEnabled();
  expect((await gate.db.query("SELECT status FROM outbound_deliveries")).rows[0]!.status).toBe("FAILED_RETRYABLE");
  gate.senderFails = false;
  await selectQuote(page, gate);
  await clickResponse(page, "Enviar ao cliente", "/publish");
  await assertPublication(gate, quote.id);
});

test("G03 lost authorization response reconciles persisted state without resubmission", async ({ gate, page }) => {
  const quote = await gate.intake();
  await selectQuote(page, gate);
  let requests = 0;
  await page.route("**/respond", async (route) => {
    requests++;
    const committed = await route.fetch({ headers: { ...route.request().headers(), authorization: gate.auth() } });
    expect(committed.status()).toBe(200);
    await route.abort("failed");
  });
  await page.getByLabel("Valor autorizado em reais").fill("282,00");
  await page.getByRole("button", { name: "Autorizar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enviar ao cliente", exact: true })).toBeVisible();
  expect(requests).toBe(1);
  expect(Number((await gate.db.query("SELECT authorized_price_amount_cents FROM quote_requests WHERE id=$1", [quote.id])).rows[0]!.authorized_price_amount_cents)).toBe(28200);
  await page.unroute("**/respond");
  await selectQuote(page, gate);
  await page.route("**/publish", async (route) => {
    const committed = await route.fetch({ headers: { ...route.request().headers(), authorization: gate.auth() } });
    expect(committed.status()).toBe(200);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Enviar ao cliente", exact: true }).click();
  await expect.poll(async () => (await gate.db.query("SELECT status FROM outbound_deliveries")).rows[0]?.status).toBe("DELIVERED");
  await page.reload();
  await expect(page.getByRole("button", { name: /João Açúcar/ })).toHaveCount(0);
  await assertPublication(gate, quote.id);
});

test("H01 every tenant endpoint rejects before any foreign repository call", async ({ gate }) => {
  await gate.intake();
  gate.repositoryCalls = [];
  for (const [method, suffix] of [["POST", "/conversations"], ["GET", "/conversations/id/messages"], ["POST", "/conversations/id/messages"], ["GET", "/conversations/id/quotes"], ["GET", "/quotes/pending"], ["POST", "/quotes/id/respond"], ["POST", "/quotes/id/publish"], ["GET", "/quotes/id/inventory"], ["POST", "/quotes/id/inventory"], ["GET", "/quotes/id/draft"], ["POST", "/quotes/id/draft"], ["POST", "/quotes/id/draft/authorize"], ["GET", "/profile"], ["PUT", "/profile"], ["GET", "/handoffs"], ["POST", "/handoffs/id/assign"], ["POST", "/handoffs/id/reply"], ["POST", "/handoffs/id/resolve"]]) {
    const response = await gate.request(`/v1/businesses/${otherBusinessId}${suffix}`, method, method === "POST" || method === "PUT" ? {} : undefined);
    expect(response.status, `${method} ${suffix}`).toBe(404);
  }
  expect(gate.repositoryCalls).toEqual([]);
});

test("I01 restart reconstructs real repositories and preserves entire commercial graph", async ({ gate, page }) => {
  const quote = await gate.intake();
  await authorizeManual(page, gate);
  const tables = ["automotive_businesses", "customers", "vehicles", "conversations", "messages", "opportunities", "quote_requests", "commercial_events", "evolution_go_conversation_links"];
  const before = new Map<string, unknown>();
  for (const table of tables) before.set(table, (await gate.db.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows);
  await gate.restart();
  for (const table of tables) expect((await gate.db.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows).toEqual(before.get(table));
  await selectQuote(page, gate);
  await clickResponse(page, "Enviar ao cliente", "/publish");
  await assertPublication(gate, quote.id);
  const delivery = (await gate.db.query("SELECT * FROM outbound_deliveries")).rows;
  await gate.restart();
  expect((await gate.db.query("SELECT * FROM outbound_deliveries")).rows).toEqual(delivery);
  expect((await gate.request(gate.route(`/quotes/${quote.id}/publish`), "POST")).status).toBe(200);
  await assertPublication(gate, quote.id);
});

test("K01 synthetic integrated quote browser to PostgreSQL to sender equals BRL 282", async ({ gate, page }) => {
  await gate.plan(AdminPlan.INTERMEDIATE, true);
  const quote = await gate.intake();
  await buildInBrowser(page, gate);
  const lines = (await gate.db.query("SELECT kind,quantity,quantity_source,unit_price_captured_amount_cents,subtotal_amount_cents FROM quote_draft_lines ORDER BY kind")).rows;
  expect(lines).toHaveLength(2);
  expect(lines.every((line) => line.quantity_source === "OPERATOR_CONFIRMED")).toBe(true);
  expect((await gate.db.query("SELECT unit FROM quote_draft_lines WHERE kind='PRODUCT'")).rows[0]!.unit).toBe("L");
  await expect(page.locator(".integrated-section:visible").first()).toContainText("48,00/L");
  expect(gate.priceCalls[0]!.identity).toEqual({ sku: "OIL-5W30" });
  expect((await clickResponse(page, "Autorizar", "/draft/authorize")).status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: /João Açúcar/ }).click();
  await expect(page.locator(".integrated-total")).toContainText("282,00");
  await clickResponse(page, "Enviar ao cliente", "/publish");
  await assertPublication(gate, quote.id);
  expect((await gate.db.query("SELECT status,total_amount_cents FROM quote_drafts")).rows[0]).toMatchObject({ status: "PUBLISHED" });
});

test("K02 integrated failures: inventory, price, invalid quantity and divergent SKU", async ({ gate, page }) => {
  await gate.plan(AdminPlan.ADVANCED, true);
  const quote = await gate.intake();
  const path = gate.route(`/quotes/${quote.id}/draft`);
  gate.inventoryAvailable = false;
  expect((await (await gate.request(path, "POST", draftBody())).json()).error).toBe("PRODUCT_UNAVAILABLE");
  expect(gate.priceCalls).toHaveLength(0);
  gate.inventoryAvailable = true; gate.priceAvailable = false;
  expect((await (await gate.request(path, "POST", draftBody())).json()).error).toBe("PRICE_UNAVAILABLE");
  gate.priceAvailable = true;
  const invalid = draftBody(); invalid.products[0]!.quantity = -1;
  expect((await gate.request(path, "POST", invalid)).status).toBe(400);
  const swapped = draftBody(); swapped.products[0]!.sku = "OTHER";
  expect((await (await gate.request(path, "POST", swapped)).json()).error).toBe("IDENTITY_AMBIGUOUS");
  expect((await gate.db.query("SELECT count(*)::int AS n FROM quote_drafts")).rows[0]!.n).toBe(0);
  await selectQuote(page, gate);
  await page.getByLabel("Produto", { exact: true }).fill("Óleo 5W30");
  await page.getByLabel("SKU", { exact: true }).fill("OTHER");
  await clickResponse(page, "Montar orçamento", "/draft");
  await expect(page.locator(".action-message")).not.toContainText("IDENTITY_AMBIGUOUS");
  await expect(page.locator(".action-message")).not.toBeEmpty();
  await expect(page.getByRole("button", { name: "Montar orçamento" })).toBeEnabled();
});

test("K03 BASIC and opt-out never call inventory or pricing providers", async ({ gate, page }) => {
  const quote = await gate.intake();
  for (const plan of [AdminPlan.BASIC, AdminPlan.INTERMEDIATE]) {
    await gate.plan(plan, plan === AdminPlan.BASIC);
    expect((await gate.request(gate.route(`/quotes/${quote.id}/draft`), "POST", draftBody())).status).toBe(403);
    await gate.request(gate.route(`/quotes/${quote.id}/inventory`), "POST");
    await selectQuote(page, gate);
    await expect(page.getByRole("button", { name: "Montar orçamento" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Autorizar", exact: true })).toBeVisible();
  }
  expect(gate.inventoryCalls).toBe(0);
  expect(gate.priceCalls).toHaveLength(0);
});

test("K04 displayed revision becomes stale and latest remains unapproved", async ({ gate, page }) => {
  await gate.plan(AdminPlan.INTERMEDIATE, true);
  const quote = await gate.intake();
  await buildInBrowser(page, gate);
  const path = gate.route(`/quotes/${quote.id}/draft`);
  const rev1 = await (await gate.request(path)).json();
  const rev2 = await (await gate.request(path, "POST", draftBody())).json();
  expect(rev2.revision).toBe(rev1.revision + 1);
  const stale = await clickResponse(page, "Autorizar", "/draft/authorize");
  expect(stale.status()).toBe(409);
  const staleHttp = await gate.request(path + "/authorize", "POST", { draftId: rev1.id, revision: rev1.revision });
  expect(staleHttp.status).toBe(409);
  expect((await staleHttp.json()).error).toBe("QUOTE_DRAFT_STALE");
  expect((await (await gate.request(path)).json()).status).toBe("PENDING_APPROVAL");
  await selectQuote(page, gate);
  expect((await clickResponse(page, "Autorizar", "/draft/authorize")).status()).toBe(200);
});

test("K05 all four composition lines visible and sum equals persisted total", async ({ gate, page }) => {
  await gate.plan(AdminPlan.INTERMEDIATE, true);
  const quote = await gate.intake();
  const body = draftBody(); body.products.push({ ...body.products[0]! }); body.labor.push({ ...body.labor[0]! });
  expect((await gate.request(gate.route(`/quotes/${quote.id}/draft`), "POST", body)).status).toBe(201);
  await selectQuote(page, gate);
  await expect(page.locator(".integrated-section:visible")).toHaveCount(4);
  await expect(page.locator(".integrated-total")).toContainText("564,00");
  const sum = (await gate.db.query("SELECT sum(subtotal_amount_cents)::int AS total FROM quote_draft_lines")).rows[0]!.total;
  expect(sum).toBe(56400);
});

test("L01 PostgreSQL publication failure rolls back Message/event/outbox and browser recovers", async ({ gate, page }) => {
  const quote = await gate.intake();
  await authorizeManual(page, gate);
  await selectQuote(page, gate);
  await gate.db.query("ALTER TABLE outbound_deliveries ADD CONSTRAINT gate_reject CHECK (false) NOT VALID");
  expect((await clickResponse(page, "Enviar ao cliente", "/publish")).status()).toBe(500);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM outbound_deliveries")).rows[0]!.n).toBe(0);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM commercial_events WHERE event_type='QUOTE_PUBLISHED'")).rows[0]!.n).toBe(0);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM messages WHERE content=$1", [moneyReply("282,00")])).rows[0]!.n).toBe(0);
  await gate.db.query("ALTER TABLE outbound_deliveries DROP CONSTRAINT gate_reject");
  await expect(page.getByRole("button", { name: "Enviar ao cliente", exact: true })).toBeEnabled();
  await clickResponse(page, "Enviar ao cliente", "/publish");
  await assertPublication(gate, quote.id);
});

test("L02 manual versus integrated authorization serialize without financial divergence", async ({ gate }) => {
  await gate.plan(AdminPlan.INTERMEDIATE, true);
  const quote = await gate.intake();
  const path = gate.route(`/quotes/${quote.id}`);
  const draft = await (await gate.request(path + "/draft", "POST", draftBody())).json();
  const [manual, integrated] = await Promise.all([gate.request(path + "/respond", "POST", { amountCents: 1, currency: "BRL", expectedUpdatedAt: quote.updated_at }), gate.request(path + "/draft/authorize", "POST", { draftId: draft.id, revision: draft.revision })]);
  expect(manual.status).toBe(409);
  expect(integrated.status).toBe(200);
  const result = (await gate.db.query("SELECT q.authorized_price_amount_cents,d.total_amount_cents FROM quote_requests q JOIN quote_drafts d ON d.quote_request_id=q.id AND d.business_id=q.business_id WHERE q.id=$1", [quote.id])).rows[0]!;
  expect(Number(result.authorized_price_amount_cents)).toBe(28200);
  expect(result.authorized_price_amount_cents).toBe(result.total_amount_cents);
});

test("K06 integrated PUBLISHED retry survives restart and never duplicates publication", async ({ gate, page }) => {
  await gate.plan(AdminPlan.INTERMEDIATE, true);
  const quote = await gate.intake();
  await buildInBrowser(page, gate);
  await clickResponse(page, "Autorizar", "/draft/authorize");
  gate.senderFails = true;
  expect((await clickResponse(page, "Enviar ao cliente", "/publish")).status()).toBe(503);
  await expect(page.locator("#feedback")).toContainText("Não foi possível");
  expect((await gate.db.query("SELECT status FROM quote_drafts")).rows[0]!.status).toBe("PUBLISHED");
  await gate.restart();
  gate.senderFails = false;
  await selectQuote(page, gate);
  await expect(page.getByRole("button", { name: "Autorizar", exact: true })).toBeHidden();
  expect((await clickResponse(page, "Enviar ao cliente", "/publish")).status()).toBe(200);
  await assertPublication(gate, quote.id);
  expect((await gate.db.query("SELECT status FROM quote_drafts")).rows[0]!.status).toBe("PUBLISHED");
  expect((await gate.request(gate.route(`/quotes/${quote.id}/publish`), "POST")).status).toBe(200);
  await assertPublication(gate, quote.id);
});

test("F02 optional integration preserves manual authorization and reload", async ({ gate, page }) => {
  await gate.plan(AdminPlan.INTERMEDIATE, true);
  const quote = await gate.intake();
  await selectQuote(page, gate);
  await page.getByRole("button", { name: "Fazer orçamento manualmente" }).click();
  await page.getByLabel("Valor autorizado em reais").fill("282,00");
  await clickResponse(page, "Autorizar", "/respond");
  await page.reload();
  await page.getByRole("button", { name: /João Açúcar/ }).click();
  await clickResponse(page, "Enviar ao cliente", "/publish");
  await assertPublication(gate, quote.id);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM quote_drafts")).rows[0]!.n).toBe(0);
});

test("G04 lost integrated authorization response reconciles without approving or sending twice", async ({ gate, page }) => {
  await gate.plan(AdminPlan.INTERMEDIATE, true);
  const quote = await gate.intake();
  await buildInBrowser(page, gate);
  let authorizations = 0;
  await page.route("**/draft/authorize", async (route) => {
    authorizations++;
    const committed = await route.fetch({ headers: { ...route.request().headers(), authorization: gate.auth() } });
    expect(committed.status()).toBe(200);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Autorizar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enviar ao cliente", exact: true })).toBeVisible();
  await expect(page.locator("#feedback")).toContainText("Não foi possível");
  expect(authorizations).toBe(1);
  expect((await gate.db.query("SELECT status FROM quote_drafts")).rows[0]!.status).toBe("APPROVED");
  expect((await gate.db.query("SELECT count(*)::int AS n FROM outbound_deliveries")).rows[0]!.n).toBe(0);
  await page.route("**/publish", async (route) => {
    const committed = await route.fetch({ headers: { ...route.request().headers(), authorization: gate.auth() } });
    expect(committed.status()).toBe(200);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Enviar ao cliente", exact: true }).click();
  await expect(page.getByRole("button", { name: /João Açúcar/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: /João Açúcar/ })).toHaveCount(0);
  await assertPublication(gate, quote.id);
});

test("K07 publication rejects divergent money and PUBLISHED without persisted delivery", async ({ gate }) => {
  await gate.plan(AdminPlan.INTERMEDIATE, true);
  const quote = await gate.intake();
  const path = gate.route(`/quotes/${quote.id}`);
  const draft = await (await gate.request(path + "/draft", "POST", draftBody())).json();
  expect((await gate.request(path + "/draft/authorize", "POST", { draftId: draft.id, revision: draft.revision })).status).toBe(200);
  await gate.db.query("UPDATE quote_requests SET authorized_price_amount_cents=1 WHERE id=$1", [quote.id]);
  expect((await gate.request(path + "/publish", "POST")).status).toBe(409);
  await gate.db.query("UPDATE quote_requests SET authorized_price_amount_cents=28200 WHERE id=$1", [quote.id]);
  await gate.dependencies.quoteDraftRepository!.markPublished(businessId, draft.id, new Date().toISOString());
  expect((await gate.request(path + "/publish", "POST")).status).toBe(409);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM outbound_deliveries")).rows[0]!.n).toBe(0);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM commercial_events WHERE event_type='QUOTE_PUBLISHED'")).rows[0]!.n).toBe(0);
  expect(gate.senderCalls).toHaveLength(1); // Only the original customer reply, no financial output.
});

const HUMAN_REPLY = "Vou encaminhar sua solicitação para a equipe responsável.";

test("M01 a customer asks for a person, waits in silence, and the operator takes over from the panel and hands the bot back", async ({ gate, page }) => {
  const sender = "5592988887777@s.whatsapp.net";
  expect((await gate.sendWebhook(gate.webhook("Quero atendente", undefined, sender))).status).toBe(202);
  expect(gate.senderCalls.map((call) => call.content)).toEqual([HUMAN_REPLY]);
  expect((await gate.sendWebhook(gate.webhook("Alguém aí?", undefined, sender))).status).toBe(202);
  expect(gate.interpreterCalls).toEqual(["Quero atendente"]);
  expect(gate.senderCalls).toHaveLength(1);
  expect((await gate.db.query("SELECT count(*)::int AS n FROM human_handoffs")).rows[0]!.n).toBe(1);

  await page.goto(gate.url + "/operator");
  const item = page.locator(".handoff-item");
  await expect(page.locator("#handoff-count")).toHaveText("1");
  await expect(item).toContainText("5592988887777");
  await expect(item).toContainText("Alguém aí?");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await item.getByRole("button", { name: "Assumir" }).click();
  await expect(item.getByRole("button", { name: "Assumir" })).toBeHidden();

  const reply = item.getByLabel("Resposta ao cliente");
  gate.senderFails = true;
  await reply.fill("Oi, aqui é da oficina. Já te ajudo.");
  await item.getByRole("button", { name: "Enviar resposta" }).click();
  await expect(item).toContainText("Não foi possível enviar");
  await expect(reply).toHaveValue("Oi, aqui é da oficina. Já te ajudo.");
  gate.senderFails = false;
  await item.getByRole("button", { name: "Enviar resposta" }).click();
  await expect(reply).toHaveValue("");
  await expect(item).toContainText("Oi, aqui é da oficina");
  expect(gate.senderCalls.filter((call) => call.delivered).at(-1)).toMatchObject({ recipientJid: sender, content: "Oi, aqui é da oficina. Já te ajudo." });
  expect((await gate.db.query("SELECT status FROM human_handoffs")).rows).toEqual([{ status: "ACCEPTED" }]);
  expect(gate.interpreterCalls).toEqual(["Quero atendente"]);

  await item.getByRole("button", { name: "Devolver ao bot" }).click();
  await expect(page.locator("#handoff-count")).toHaveText("0");
  await expect(page.locator(".handoff-item")).toHaveCount(0);
  expect((await gate.db.query("SELECT status FROM conversations")).rows).toEqual([{ status: "ACTIVE" }]);
  expect((await gate.db.query("SELECT status FROM human_handoffs")).rows).toEqual([{ status: "RESOLVED" }]);

  expect((await gate.sendWebhook(gate.webhook("Voltei, e o carro?", undefined, sender))).status).toBe(202);
  expect(gate.interpreterCalls).toEqual(["Quero atendente", "Voltei, e o carro?"]);
  expect(gate.senderCalls.filter((call) => call.delivered).at(-1)!.content).toBe("Olá! Atendimento São José — ação, ç, ã, 🚗.");
});

test("N01 workshop data saved on the panel reach the interpreter as facts and the out-of-hours answer says when the workshop opens", async ({ gate, page }) => {
  gate.clock = Date.parse("2026-11-07T15:00:00.000Z"); // Saturday afternoon, after the Saturday hours
  await page.goto(gate.url + "/operator");
  await page.getByText("Dados da oficina").click();
  await page.getByLabel("Endereço").fill("Rua das Oficinas, 10");
  await page.getByLabel("Telefone da oficina").fill("(92) 3333-4444");
  await page.getByLabel("WhatsApp para avisos").fill("(92) 99999-1234");
  for (const day of ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"]) await page.getByLabel(day).fill("08:00-18:00");
  await page.getByLabel("Sábado").fill("08:00-12:00");
  await page.getByLabel("Serviços (um por linha)").fill("Troca de óleo\nFreios");
  await page.getByLabel("Formas de pagamento (um por linha)").fill("Pix\nCartão");
  await page.getByRole("button", { name: "Salvar dados" }).click();
  await expect(page.locator("#profile-message")).toHaveText("Dados salvos.");
  const stored = (await gate.db.query("SELECT address,notify_phone,opening_hours,services FROM business_profiles WHERE business_id=$1", [businessId])).rows[0]!;
  expect(stored).toMatchObject({ address: "Rua das Oficinas, 10", notify_phone: "5592999991234", services: ["Troca de óleo", "Freios"] });
  expect(stored.opening_hours["6"]).toEqual([{ open: "08:00", close: "12:00" }]);

  await page.reload();
  await page.getByText("Dados da oficina").click();
  await expect(page.getByLabel("Sábado")).toHaveValue("08:00-12:00");
  await expect(page.getByLabel("Domingo")).toHaveValue("");

  expect((await gate.sendWebhook(gate.webhook("abrem sábado?"))).status).toBe(202);
  const received = gate.interpreterInputs.at(-1)!;
  expect(received.businessFacts).toEqual({
    address: "Rua das Oficinas, 10", phone: "(92) 3333-4444",
    openingHours: { domingo: "fechado", "segunda-feira": "08:00-18:00", "terça-feira": "08:00-18:00", "quarta-feira": "08:00-18:00", "quinta-feira": "08:00-18:00", "sexta-feira": "08:00-18:00", sábado: "08:00-12:00" },
    services: ["Troca de óleo", "Freios"], paymentMethods: ["Pix", "Cartão"],
  });
  expect(received.localDateTime).toBe("2026-11-07 15:00 (sábado, UTC)");
  expect(JSON.stringify(received)).not.toContain("5592999991234");
  expect(gate.senderCalls.at(-1)!.content).toBe("Olá! Atendimento São José — ação, ç, ã, 🚗.\nEstamos fora do horário de atendimento. Voltamos na segunda-feira às 08:00.");
});
