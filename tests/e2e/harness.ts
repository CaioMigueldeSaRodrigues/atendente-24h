import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test as base, expect } from "@playwright/test";
import { BusinessType, Channel, Intent, InventoryAvailability } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { AdminPlan } from "../../src/core/admin-plan-entitlement.js";
import { AssignmentBusinessCapabilityPolicy } from "../../src/core/business-capability-policy.js";
import { BasicBusinessOperatorAuthorizer } from "../../src/infrastructure/http/basic-business-operator-authorizer.js";
import { createBasicPlanHttpServer, type BasicPlanHttpServerDependencies } from "../../src/infrastructure/http/basic-plan-http-server.js";
import { PostgresDatabase } from "../../src/infrastructure/postgres/postgres-database.js";
import { applyPostgresMigrations } from "../../src/infrastructure/postgres/postgres-migrations.js";
import * as R from "../../src/infrastructure/postgres/postgres-repositories.js";
import { PostgresStockCheckRepository } from "../../src/infrastructure/postgres/postgres-stock-check-repository.js";
import { PostgresQuoteDraftRepository } from "../../src/infrastructure/postgres/postgres-quote-draft-repository.js";
import { PostgresBusinessPlanAssignmentRepository } from "../../src/infrastructure/postgres/postgres-business-plan-assignment-repository.js";
import { PostgresBusinessAssistantIntegrationSettingsRepository } from "../../src/infrastructure/postgres/postgres-business-assistant-integration-settings-repository.js";
import type { ProductPriceReadInput } from "../../src/core/product-price-read-port.js";
import { gateEnvironment } from "./environment.js";

export const businessId = "gate-workshop-a";
export const otherBusinessId = "gate-workshop-b";
export const customerText = "Sou João Açúcar. Toyota Corolla XEi 2020. Quero troca de óleo 5W30.";
export const moneyReply = (amount: string) => `O orçamento autorizado é de R$ ${amount}. Deseja prosseguir?`;
export const draftBody = () => ({ products: [{ requestedItem: "Óleo 5W30", sku: "OIL-5W30", quantity: 4, quantitySource: "OPERATOR_CONFIRMED" }], labor: [{ description: "Troca de óleo", quantity: 1, quantitySource: "OPERATOR_CONFIRMED" }] });

export class Harness {
  readonly schema = `gate1_${randomUUID().replaceAll("-", "")}`;
  readonly credentials = { username: "gate-operator", password: randomUUID() };
  readonly webhookToken = randomUUID();
  readonly instance = "gate-instance";
  readonly config = gateEnvironment();
  db!: PostgresDatabase;
  dependencies!: BasicPlanHttpServerDependencies;
  server!: Server;
  url = "";
  interpreterMode: "normal" | "throw" | "timeout" = "normal";
  interpreterCalls: string[] = [];
  senderFails = false;
  senderCalls: Array<{ recipientJid: string; content: string; delivered: boolean }> = [];
  inventoryCalls = 0;
  inventoryAvailable = true;
  priceAvailable = true;
  priceCalls: ProductPriceReadInput[] = [];
  repositoryCalls: Array<{ repository: string; method: string; businessId: unknown }> = [];

  async initialize() {
    const admin = new PostgresDatabase(this.config, { allowInsecureLocal: true });
    try {
      const version = await admin.query("SHOW server_version_num");
      assert.equal(Math.floor(Number(version.rows[0]!.server_version_num) / 10000), 16, "Gate 1 requires PostgreSQL 16");
      await admin.query(`CREATE SCHEMA "${this.schema}"`);
    } finally { await admin.close(); }
    await this.start(true);
  }

  async start(empty = false) {
    this.db = new PostgresDatabase(this.config, { allowInsecureLocal: true, searchPath: this.schema });
    const applied = await applyPostgresMigrations(this.db);
    assert.deepEqual(applied.map((name) => name.slice(0, 3)), empty ? ["001", "002", "003", "004", "005", "006", "007"] : []);
    assert.deepEqual(await applyPostgresMigrations(this.db), []);
    const now = () => new Date().toISOString();
    const businesses = new R.PostgresAutomotiveBusinessRepository(this.db);
    if (empty) {
      for (const id of [businessId, otherBusinessId]) await businesses.save({ id, name: id, businessType: BusinessType.WORKSHOP, timezone: "UTC", active: true, createdAt: now(), updatedAt: now() });
      await this.plan(AdminPlan.BASIC);
    }
    // These proxies observe calls; every operation still executes its real PostgreSQL repository.
    const observe = <T extends object>(repository: T): T => new Proxy(repository, {
      get: (target, key, receiver) => {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const first = args[0];
          this.repositoryCalls.push({ repository: target.constructor.name, method: String(key), businessId: typeof first === "object" && first !== null && "businessId" in first ? first.businessId : first });
          return Reflect.apply(value, target, args);
        };
      },
    });
    const sender = { sendText: async (message: { recipientJid: string; content: string }) => {
      this.senderCalls.push({ ...message, delivered: !this.senderFails });
      if (this.senderFails) throw new Error("Synthetic sender unavailable");
    } };
    this.dependencies = {
      conversationRepository: observe(new R.PostgresConversationRepository(this.db)),
      messageRepository: observe(new R.PostgresMessageRepository(this.db)),
      customerRepository: observe(new R.PostgresCustomerRepository(this.db)),
      vehicleRepository: observe(new R.PostgresVehicleRepository(this.db)),
      opportunityRepository: observe(new R.PostgresOpportunityRepository(this.db)),
      quoteRequestRepository: observe(new R.PostgresQuoteRequestRepository(this.db)),
      outboundDeliveryRepository: observe(new R.PostgresOutboundDeliveryRepository(this.db)),
      commercialEventRepository: observe(new R.PostgresCommercialEventRepository(this.db)),
      appointmentRepository: observe(new R.PostgresAppointmentRepository(this.db)),
      humanHandoffRepository: observe(new R.PostgresHumanHandoffRepository(this.db)),
      stockCheckRepository: observe(new PostgresStockCheckRepository(this.db)),
      quoteDraftRepository: observe(new PostgresQuoteDraftRepository(this.db)),
      businessCapabilityPolicy: new AssignmentBusinessCapabilityPolicy(new PostgresBusinessPlanAssignmentRepository(this.db), new PostgresBusinessAssistantIntegrationSettingsRepository(this.db), { inventory: true, productPricing: true, laborPricing: true }),
      businessOperatorAuthorizer: new BasicBusinessOperatorAuthorizer(businessId, this.credentials.username, this.credentials.password),
      quoteTransaction: { run: (id, quote, operation) => this.db.transaction(async (client) => {
        const locked = await client.query("SELECT id FROM quote_requests WHERE business_id=$1 AND id=$2 FOR UPDATE", [id, quote]);
        if (locked.rowCount !== 1) throw new Error("QuoteRequest not found");
        return operation();
      }) },
      evolutionGoWebhookTransaction: { run: (operation) => this.db.transaction(async () => operation()) },
      evolutionGoConversationLinkRepository: observe(new R.PostgresEvolutionGoConversationLinkRepository(this.db)),
      evolutionGoWebhookReplayGuard: new R.PostgresEvolutionGoWebhookReplayGuard(this.db),
      evolutionGoWebhookCredentials: [{ businessId, instanceName: this.instance, instanceToken: this.webhookToken }],
      evolutionGoTextSender: sender,
      channelTextSenders: { [Channel.WHATSAPP]: sender },
      inventoryReadPort: { check: async () => {
        this.inventoryCalls++;
        return this.inventoryAvailable ? { availability: InventoryAvailability.AVAILABLE, sku: "OIL-5W30", description: "Óleo 5W30", availableQuantity: 20, unit: "L", source: "gate1-synthetic", checkedAt: now() } : { availability: InventoryAvailability.UNKNOWN, source: "gate1-synthetic" };
      } },
      productPriceReadPort: { read: async (input) => {
        this.priceCalls.push(input);
        assert.equal(input.identity.sku, "OIL-5W30");
        return this.priceAvailable ? { status: "AVAILABLE", price: { amountCents: 4800, currency: "BRL" }, source: "gate1-synthetic", checkedAt: now() } : { status: "PRICE_UNAVAILABLE" };
      } },
      laborPriceReadPort: { read: async () => ({ status: "AVAILABLE", price: { amountCents: 9000, currency: "BRL" }, source: "gate1-synthetic", checkedAt: now() }) },
      operator: { businessId, businessName: "Oficina Gate 1", integratedQuotes: true },
      interpreter: { interpret: async ({ content }) => {
        this.interpreterCalls.push(content);
        if (this.interpreterMode === "throw") throw new Error("Synthetic interpreter unavailable");
        if (this.interpreterMode === "timeout") { await new Promise((resolve) => setTimeout(resolve, 30)); throw new Error("Synthetic interpreter deadline exceeded"); }
        const quote = content.includes("óleo") || content === "Quero orçamento";
        const incomplete = content === "Quero orçamento";
        const interpretation: AIInterpretation = {
          intent: quote ? Intent.QUOTE_REQUEST : Intent.GENERAL_INFORMATION,
          extractedCustomerData: content.includes("João") ? { name: "João Açúcar" } : {},
          extractedVehicleData: content.includes("Toyota") ? { brand: "Toyota", model: "Corolla", year: 2020, version: "XEi" } : {},
          missingData: incomplete ? ["requestedItem"] : [],
          suggestedNextAction: { type: quote ? "PROVIDE_QUOTE" : "NONE", description: "Gate 1" },
          requiresHuman: content === "Quero atendente",
          proposedResponse: "Olá! Atendimento São José — ação, ç, ã, 🚗.",
          ...(quote && !incomplete ? { requestedItem: "Troca de óleo" } : {}),
        };
        return interpretation;
      } },
      now, generateId: (prefix) => `${prefix}-${randomUUID()}`,
    };
    this.server = createBasicPlanHttpServer(this.dependencies);
    await new Promise<void>((resolve, reject) => { this.server.once("error", reject); this.server.listen(0, "127.0.0.1", resolve); });
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async plan(plan: AdminPlan, optIn = false) {
    const at = new Date().toISOString();
    await new PostgresBusinessPlanAssignmentRepository(this.db).save({ id: "gate-plan", businessId, plan, status: "ACTIVE", startedAt: at, updatedAt: at, source: "gate1" });
    await new PostgresBusinessAssistantIntegrationSettingsRepository(this.db).save({ businessId, inventoryForAssistantEnabled: optIn, productPricingForAssistantEnabled: optIn, laborPricingForAssistantEnabled: optIn, createdAt: at, updatedAt: at });
  }
  auth() { return `Basic ${Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString("base64")}`; }
  request(path: string, method = "GET", body?: unknown, authorized = true) {
    return fetch(this.url + path, { method, headers: { ...(authorized ? { authorization: this.auth() } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  route(path: string) { return `/v1/businesses/${businessId}${path}`; }
  webhook(content = customerText, id = randomUUID(), sender = `${Date.now()}@s.whatsapp.net`) {
    return { event: "Message", instanceName: this.instance, instanceToken: this.webhookToken, data: { Info: { ID: id, Type: "text", Sender: sender, Chat: sender, Timestamp: new Date().toISOString(), IsFromMe: false, IsGroup: false }, Message: { conversation: content } } };
  }
  sendWebhook(payload: unknown) { return this.request("/v1/channels/whatsapp/evolution-go/webhook", "POST", payload, false); }
  async intake() {
    const response = await this.sendWebhook(this.webhook());
    expect(response.status).toBe(202);
    const result = await this.db.query("SELECT * FROM quote_requests WHERE business_id=$1 ORDER BY created_at DESC LIMIT 1", [businessId]);
    expect(result.rows).toHaveLength(1);
    return result.rows[0]! as { id: string; conversation_id: string };
  }
  async stop() { if (this.server?.listening) await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve())); if (this.db) await this.db.close(); }
  async restart() { await this.stop(); await this.start(); }
  async dispose() {
    try { await this.stop(); } finally {
      const admin = new PostgresDatabase(this.config, { allowInsecureLocal: true });
      try { await admin.query(`DROP SCHEMA IF EXISTS "${this.schema}" CASCADE`); } finally { await admin.close(); }
    }
  }
}

export const test = base.extend<{ gate: Harness }>({
  gate: async ({}, use) => { const harness = new Harness(); try { await harness.initialize(); await use(harness); } finally { await harness.dispose(); } },
  context: async ({ browser, gate, viewport, isMobile, hasTouch }, use) => {
    const context = await browser.newContext({ httpCredentials: gate.credentials, ...(viewport ? { viewport } : {}), ...(isMobile === undefined ? {} : { isMobile }), ...(hasTouch === undefined ? {} : { hasTouch }) });
    await context.route("**/*", (route) => route.request().url().startsWith(gate.url + "/") ? route.continue() : route.abort("blockedbyclient"));
    try { await use(context); } finally { await context.close(); }
  },
});
export { expect };
