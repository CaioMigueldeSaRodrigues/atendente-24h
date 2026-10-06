import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { MessageInterpreter } from "../core/message-interpreter.js";
import type { EvolutionGoWebhookCredential } from "../channels/whatsapp/evolution-go-webhook-auth.js";
import { EvolutionGoTextSender, type EvolutionGoTextMessage } from "../channels/whatsapp/evolution-go-text-sender.js";
import { createBasicPlanHttpServer } from "../infrastructure/http/basic-plan-http-server.js";
import { PostgresDatabase, type PostgresEnvironment } from "../infrastructure/postgres/postgres-database.js";
import {
  PostgresAutomotiveBusinessRepository, PostgresCommercialEventRepository,
  PostgresAppointmentRepository, PostgresConversationRepository, PostgresCustomerRepository,
  PostgresEvolutionGoConversationLinkRepository, PostgresEvolutionGoWebhookReplayGuard, PostgresMessageRepository,
  PostgresHumanHandoffRepository, PostgresOpportunityRepository, PostgresQuoteRequestRepository, PostgresVehicleRepository,
  PostgresOutboundDeliveryRepository,
} from "../infrastructure/postgres/postgres-repositories.js";
import { applyPostgresMigrations } from "../infrastructure/postgres/postgres-migrations.js";
import { Channel, type BusinessType } from "../core/domain/enums.js";
import { PostgresStockCheckRepository } from "../infrastructure/postgres/postgres-stock-check-repository.js";
import { UnavailableInventoryReadAdapter } from "../infrastructure/inventory/local-inventory-read-adapter.js";
import { PostgresQuoteDraftRepository } from "../infrastructure/postgres/postgres-quote-draft-repository.js";
import { PostgresBusinessPlanAssignmentRepository } from "../infrastructure/postgres/postgres-business-plan-assignment-repository.js";
import { PostgresBusinessAssistantIntegrationSettingsRepository } from "../infrastructure/postgres/postgres-business-assistant-integration-settings-repository.js";
import { AssignmentBusinessCapabilityPolicy } from "../core/business-capability-policy.js";
import { UnavailableProductPriceReadAdapter } from "../infrastructure/pricing/local-product-price-read-adapter.js";
import { UnavailableLaborPriceReadAdapter } from "../infrastructure/pricing/local-labor-price-read-adapter.js";
import type { BusinessOperatorAuthorizer } from "../core/business-operator-authorizer.js";

export type BasicPlanPostgresRuntimeOptions = {
  postgres: PostgresEnvironment;
  business: { businessId: string; businessName: string; businessType: BusinessType; timezone: string };
  businessOperatorAuthorizer: BusinessOperatorAuthorizer;
  interpreter: MessageInterpreter;
  evolutionGoWebhookCredential?: EvolutionGoWebhookCredential;
  evolutionGoBaseUrl?: string;
  evolutionGoTextSender?: { sendText(message: EvolutionGoTextMessage): Promise<void> };
  now?: () => string;
  allowInsecureLocalForTests?: boolean;
};

export async function createBasicPlanPostgresRuntime(options: BasicPlanPostgresRuntimeOptions) {
  if (options.evolutionGoWebhookCredential && options.evolutionGoWebhookCredential.businessId !== options.business.businessId) {
    throw new Error("Evolution Go webhook business does not match the configured business");
  }
  if (options.evolutionGoWebhookCredential && !options.evolutionGoTextSender && !options.evolutionGoBaseUrl) {
    throw new Error("Evolution Go base URL is required when the webhook is configured");
  }
  const database = new PostgresDatabase(options.postgres, options.allowInsecureLocalForTests === undefined
    ? {} : { allowInsecureLocal: options.allowInsecureLocalForTests });
  let server: Server | undefined;
  try {
    await applyPostgresMigrations(database);
    const now = options.now ?? (() => new Date().toISOString());
    const businessRepository = new PostgresAutomotiveBusinessRepository(database);
    const storedBusiness = await businessRepository.findById(options.business.businessId);
    if (!storedBusiness) {
      const timestamp = now();
      await businessRepository.save({ id: options.business.businessId, name: options.business.businessName,
        businessType: options.business.businessType, timezone: options.business.timezone,
        active: true, createdAt: timestamp, updatedAt: timestamp });
    } else if (storedBusiness.name !== options.business.businessName || storedBusiness.businessType !== options.business.businessType || storedBusiness.timezone !== options.business.timezone) {
      throw new Error("Configured business does not match the existing business");
    }

    const evolutionGoTextSender = options.evolutionGoWebhookCredential
      ? options.evolutionGoTextSender ?? new EvolutionGoTextSender({
          baseUrl: options.evolutionGoBaseUrl!,
          instanceToken: options.evolutionGoWebhookCredential.instanceToken,
        })
      : undefined;

    server = createBasicPlanHttpServer({
      conversationRepository: new PostgresConversationRepository(database),
      messageRepository: new PostgresMessageRepository(database),
      outboundDeliveryRepository: new PostgresOutboundDeliveryRepository(database),
      customerRepository: new PostgresCustomerRepository(database),
      vehicleRepository: new PostgresVehicleRepository(database),
      opportunityRepository: new PostgresOpportunityRepository(database),
      quoteRequestRepository: new PostgresQuoteRequestRepository(database),
      inventoryReadPort: new UnavailableInventoryReadAdapter(),
      stockCheckRepository: new PostgresStockCheckRepository(database),
      quoteDraftRepository: new PostgresQuoteDraftRepository(database),
      quoteTransaction: { run: (businessId, quoteRequestId, operation) => database.transaction(async (client) => {
        const locked = await client.query("SELECT id FROM quote_requests WHERE business_id=$1 AND id=$2 FOR UPDATE", [businessId, quoteRequestId]);
        if (locked.rowCount !== 1) throw new Error("QuoteRequest not found");
        return operation();
      }) },
      productPriceReadPort: new UnavailableProductPriceReadAdapter(),
      laborPriceReadPort: new UnavailableLaborPriceReadAdapter(),
      businessCapabilityPolicy: new AssignmentBusinessCapabilityPolicy(new PostgresBusinessPlanAssignmentRepository(database), new PostgresBusinessAssistantIntegrationSettingsRepository(database), { inventory: false, productPricing: false, laborPricing: false }),
      businessOperatorAuthorizer: options.businessOperatorAuthorizer,
      commercialEventRepository: new PostgresCommercialEventRepository(database),
      evolutionGoWebhookReplayGuard: new PostgresEvolutionGoWebhookReplayGuard(database),
      evolutionGoConversationLinkRepository: new PostgresEvolutionGoConversationLinkRepository(database),
      evolutionGoWebhookTransaction: {
        run: (operation) => database.transaction(async () => operation()),
      },
      ...(options.evolutionGoWebhookCredential ? { evolutionGoWebhookCredentials: [options.evolutionGoWebhookCredential] } : {}),
      ...(evolutionGoTextSender
        ? {
            evolutionGoTextSender,
            channelTextSenders: { [Channel.WHATSAPP]: evolutionGoTextSender },
          }
        : {}),
      appointmentRepository: new PostgresAppointmentRepository(database),
      humanHandoffRepository: new PostgresHumanHandoffRepository(database),
      operator: { businessId: options.business.businessId, businessName: options.business.businessName, integratedQuotes: true },
      interpreter: options.interpreter,
      now,
      generateId: (prefix) => `${prefix}-${randomUUID()}`,
    });
    let closing: Promise<void> | undefined;
    return { server, database, close: () => closing ??= (async () => {
      try { if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((e) => e ? reject(e) : resolve())); }
      finally { await database.close(); }
    })() };
  } catch (error) {
    await database.close();
    throw error;
  }
}
