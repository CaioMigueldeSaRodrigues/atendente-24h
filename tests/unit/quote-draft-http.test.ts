import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { Channel, ConversationStatus, InventoryAvailability, OpportunityStatus, QuoteRequestStatus } from "../../src/core/domain/enums.js";
import type { StockCheck } from "../../src/core/domain/entities.js";
import { InMemoryAppointmentRepository, InMemoryCommercialEventRepository, InMemoryConversationRepository, InMemoryCustomerRepository, InMemoryHumanHandoffRepository, InMemoryMessageRepository, InMemoryOpportunityRepository, InMemoryOutboundDeliveryRepository, InMemoryQuoteDraftRepository, InMemoryQuoteRequestRepository, InMemoryVehicleRepository } from "../../src/core/in-memory-repositories.js";
import type { StockCheckRepository } from "../../src/core/repositories.js";
import { StaticBusinessCapabilityPolicy } from "../../src/core/business-capability-policy.js";
import { AdminPlan } from "../../src/core/admin-plan-entitlement.js";
import { createBasicPlanHttpServer, type BasicPlanHttpServerDependencies } from "../../src/infrastructure/http/basic-plan-http-server.js";
import { LocalLaborPriceReadAdapter } from "../../src/infrastructure/pricing/local-labor-price-read-adapter.js";
import { LocalProductPriceReadAdapter } from "../../src/infrastructure/pricing/local-product-price-read-adapter.js";

class HttpStockChecks implements StockCheckRepository {
  async save(_entity: StockCheck): Promise<void> {}
  async findLatestByQuoteRequest(_businessId: string, _quoteRequestId: string): Promise<StockCheck | null> { return null; }
  async listByBusiness(_businessId: string): Promise<StockCheck[]> { return []; }
}

test("integrated draft endpoints gate by plan, calculate without outbox and authorize separately", async () => {
  const quoteRequests = new InMemoryQuoteRequestRepository();
  const opportunities = new InMemoryOpportunityRepository();
  await quoteRequests.save({ id: "quote-http", businessId: "business-http", opportunityId: "opportunity-http", conversationId: "conversation-http", requestDescription: "Troca de óleo", status: QuoteRequestStatus.WAITING_BUSINESS, requestedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  await opportunities.save({ id: "opportunity-http", businessId: "business-http", conversationId: "conversation-http", status: OpportunityStatus.WAITING_BUSINESS, nextAction: { type: "PROVIDE_QUOTE", description: "Aguardar orçamento" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  let sequence = 0;
  const dependencies: BasicPlanHttpServerDependencies = {
    conversationRepository: new InMemoryConversationRepository(), messageRepository: new InMemoryMessageRepository(), customerRepository: new InMemoryCustomerRepository(), vehicleRepository: new InMemoryVehicleRepository(), opportunityRepository: opportunities, quoteRequestRepository: quoteRequests, outboundDeliveryRepository: new InMemoryOutboundDeliveryRepository(), appointmentRepository: new InMemoryAppointmentRepository(), humanHandoffRepository: new InMemoryHumanHandoffRepository(), commercialEventRepository: new InMemoryCommercialEventRepository(), stockCheckRepository: new HttpStockChecks(), quoteDraftRepository: new InMemoryQuoteDraftRepository(), quoteTransaction: { run: async (_businessId, _quoteRequestId, operation) => operation() }, inventoryReadPort: { check: async () => ({ availability: InventoryAvailability.AVAILABLE, externalItemId: "oil", source: "local-fixture", checkedAt: "2026-01-01T10:00:00.000Z" }) }, productPriceReadPort: new LocalProductPriceReadAdapter([{ businessId: "business-http", identity: { externalItemId: "oil" }, priceCents: 4800, checkedAt: "2026-01-01T10:00:00.000Z" }]), laborPriceReadPort: new LocalLaborPriceReadAdapter([{ businessId: "business-http", description: "Troca de óleo", priceCents: 9000, checkedAt: "2026-01-01T10:00:00.000Z" }]), businessCapabilityPolicy: new StaticBusinessCapabilityPolicy(AdminPlan.INTERMEDIATE), evolutionGoWebhookTransaction: { run: async <T>(operation: () => Promise<T>) => operation() }, operator: { businessId: "business-http", businessName: "Oficina HTTP" }, interpreter: { interpret: async () => { throw new Error("not used"); } }, now: () => "2026-01-01T10:00:00.000Z", generateId: (prefix: string) => `${prefix}-${++sequence}`,
    integrationProviderAvailability: { inventory: true, productPricing: true, laborPricing: true },
  };
  dependencies.businessCapabilityPolicy = new StaticBusinessCapabilityPolicy(AdminPlan.INTERMEDIATE, { inventoryForAssistantEnabled: true, productPricingForAssistantEnabled: true, laborPricingForAssistantEnabled: true }, { inventory: true, productPricing: true, laborPricing: true });
  await dependencies.conversationRepository.save({ id: "conversation-http", businessId: "business-http", channel: Channel.WEB, status: ConversationStatus.ACTIVE, startedAt: "2026-01-01T00:00:00.000Z", lastMessageAt: "2026-01-01T00:00:00.000Z" });
  const server = createBasicPlanHttpServer(dependencies);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const capabilities = await fetch(`${base}/v1/businesses/business-http/capabilities`);
    const capabilityBody = await capabilities.json() as { plan: string; entitlements: { inventoryIntegration: boolean }; settings: { inventoryForAssistantEnabled: boolean; productPricingForAssistantEnabled: boolean; laborPricingForAssistantEnabled: boolean }; capabilities: { canBuildIntegratedQuote: boolean } };
    assert.equal(capabilityBody.plan, "INTERMEDIATE");
    assert.equal(capabilityBody.entitlements.inventoryIntegration, true);
    assert.deepEqual(capabilityBody.settings, { inventoryForAssistantEnabled: true, productPricingForAssistantEnabled: true, laborPricingForAssistantEnabled: true });
    assert.equal(capabilityBody.capabilities.canBuildIntegratedQuote, true);
    const missingQuantitySource = await fetch(`${base}/v1/businesses/business-http/quotes/quote-http/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ products: [{ requestedItem: "Óleo 5W30", externalItemId: "oil", quantity: 4 }], labor: [] }) });
    assert.equal(missingQuantitySource.status, 400);
    const inferredQuantity = await fetch(`${base}/v1/businesses/business-http/quotes/quote-http/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ products: [{ requestedItem: "Óleo 5W30", externalItemId: "oil", quantity: 4, quantitySource: "LLM_INFERRED" }], labor: [] }) });
    assert.equal(inferredQuantity.status, 400);
    const draftResponse = await fetch(`${base}/v1/businesses/business-http/quotes/quote-http/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ products: [{ requestedItem: "Óleo 5W30", externalItemId: "oil", quantity: 4, quantitySource: "OPERATOR_CONFIRMED" }], labor: [{ description: "Troca de óleo", quantity: 1, quantitySource: "OPERATOR_CONFIRMED" }] }) });
    assert.equal(draftResponse.status, 201);
    const draft = await draftResponse.json() as { status: string; total: { amountCents: number } };
    assert.equal(draft.status, "PENDING_APPROVAL");
    assert.equal(draft.total.amountCents, 28200);
    for (const channel of Object.values(Channel)) assert.equal(await dependencies.outboundDeliveryRepository.findByQuoteRequestAndChannel("business-http", "quote-http", channel), null);
    const authorized = await fetch(`${base}/v1/businesses/business-http/quotes/quote-http/draft/authorize`, { method: "POST" });
    assert.equal(authorized.status, 200);
    assert.equal((await quoteRequests.findById("business-http", "quote-http"))?.authorizedPrice?.amountCents, 28200);
    const integratedPublish = await fetch(`${base}/v1/businesses/business-http/quotes/quote-http/publish`, { method: "POST" });
    assert.equal(integratedPublish.status, 200);
    assert.equal((await dependencies.quoteDraftRepository!.findLatestByQuoteRequest("business-http", "quote-http"))?.status, "PUBLISHED");
    assert.ok(await dependencies.outboundDeliveryRepository.findByQuoteRequestAndChannel("business-http", "quote-http", Channel.WEB));
    dependencies.businessCapabilityPolicy = new StaticBusinessCapabilityPolicy(AdminPlan.BASIC);
    assert.equal((await fetch(`${base}/v1/businesses/business-http/quotes/quote-http/draft`)).status, 403);

    await quoteRequests.save({ id: "quote-manual", businessId: "business-http", opportunityId: "opportunity-http", conversationId: "conversation-http", requestDescription: "Revisão", status: QuoteRequestStatus.WAITING_BUSINESS, requestedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const manualRespond = await fetch(`${base}/v1/businesses/business-http/quotes/quote-manual/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountCents: 10000, currency: "BRL" }) });
    assert.equal(manualRespond.status, 200);
    const manualPublish = await fetch(`${base}/v1/businesses/business-http/quotes/quote-manual/publish`, { method: "POST" });
    assert.equal(manualPublish.status, 200);
    assert.equal(await dependencies.quoteDraftRepository!.findLatestByQuoteRequest("business-http", "quote-manual"), null);

    let providerCalls = 0;
    dependencies.inventoryReadPort = { check: async () => { providerCalls += 1; return { availability: InventoryAvailability.AVAILABLE, externalItemId: "oil" }; } };
    dependencies.productPriceReadPort = { read: async () => { providerCalls += 1; return { status: "AVAILABLE", price: { amountCents: 4800, currency: "BRL" }, source: "test", checkedAt: "2026-01-01T10:00:00.000Z" }; } };
    dependencies.laborPriceReadPort = { read: async () => { providerCalls += 1; return { status: "AVAILABLE", price: { amountCents: 9000, currency: "BRL" }, source: "test", checkedAt: "2026-01-01T10:00:00.000Z" }; } };
    dependencies.businessCapabilityPolicy = new StaticBusinessCapabilityPolicy(AdminPlan.INTERMEDIATE, {}, { inventory: true, productPricing: true, laborPricing: true });
    const disabledDraft = await fetch(`${base}/v1/businesses/business-http/quotes/quote-http/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ products: [{ requestedItem: "Óleo 5W30", externalItemId: "oil", quantity: 4 }], labor: [{ description: "Troca de óleo", quantity: 1 }] }) });
    assert.equal(disabledDraft.status, 403);
    assert.equal((await disabledDraft.json()).error, "DISABLED_BY_BUSINESS");
    assert.equal(providerCalls, 0);

    dependencies.integrationProviderAvailability = { inventory: false, productPricing: false, laborPricing: false };
    dependencies.businessCapabilityPolicy = new StaticBusinessCapabilityPolicy(AdminPlan.INTERMEDIATE, { inventoryForAssistantEnabled: true, productPricingForAssistantEnabled: true, laborPricingForAssistantEnabled: true });
    const unavailableCapabilities = await fetch(`${base}/v1/businesses/business-http/capabilities`);
    assert.equal((await unavailableCapabilities.json()).providerAvailability.inventory, "PROVIDER_UNAVAILABLE");
    const unavailableDraft = await fetch(`${base}/v1/businesses/business-http/quotes/quote-http/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ products: [{ requestedItem: "Óleo 5W30", externalItemId: "oil", quantity: 4 }], labor: [{ description: "Troca de óleo", quantity: 1 }] }) });
    assert.equal(unavailableDraft.status, 503);
    assert.equal((await unavailableDraft.json()).error, "PROVIDER_UNAVAILABLE");
    assert.equal(providerCalls, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
