import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Server } from "node:http";
import type { AutomotiveBusiness } from "../core/domain/entities.js";
import { Channel, type BusinessType } from "../core/domain/enums.js";
import type { MessageInterpreter } from "../core/message-interpreter.js";
import type { EvolutionGoWebhookCredential } from "../channels/whatsapp/evolution-go-webhook-auth.js";
import { EvolutionGoTextSender, type EvolutionGoTextMessage } from "../channels/whatsapp/evolution-go-text-sender.js";
import {
  InMemoryAppointmentRepository,
  InMemoryHumanHandoffRepository,
} from "../core/in-memory-repositories.js";
import { createBasicPlanHttpServer } from "../infrastructure/http/basic-plan-http-server.js";
import { createSqliteDatabase } from "../infrastructure/sqlite/sqlite-database.js";
import { SqliteEvolutionGoWebhookReplayGuard } from "../infrastructure/sqlite/sqlite-evolution-go-webhook-replay-guard.js";
import { withSqliteTransaction } from "../infrastructure/sqlite/sqlite-connection-lock.js";
import { SqliteEvolutionGoConversationLinkRepository } from "../infrastructure/sqlite/sqlite-evolution-go-conversation-link-repository.js";
import { SqliteAutomotiveBusinessRepository } from "../infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteCommercialEventRepository } from "../infrastructure/sqlite/sqlite-commercial-event-repository.js";
import { SqliteCustomerRepository } from "../infrastructure/sqlite/sqlite-customer-repository.js";
import { SqliteMessageRepository } from "../infrastructure/sqlite/sqlite-message-repository.js";
import { SqliteOutboundDeliveryRepository } from "../infrastructure/sqlite/sqlite-outbound-delivery-repository.js";
import { SqliteOpportunityRepository } from "../infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteQuoteRequestRepository } from "../infrastructure/sqlite/sqlite-quote-request-repository.js";
import { SqliteVehicleRepository } from "../infrastructure/sqlite/sqlite-vehicle-repository.js";
import { SqliteStockCheckRepository } from "../infrastructure/sqlite/sqlite-stock-check-repository.js";
import { SqliteQuoteDraftRepository } from "../infrastructure/sqlite/sqlite-quote-draft-repository.js";
import { SqliteBusinessPlanAssignmentRepository } from "../infrastructure/sqlite/sqlite-business-plan-assignment-repository.js";
import { SqliteBusinessAssistantIntegrationSettingsRepository } from "../infrastructure/sqlite/sqlite-business-assistant-integration-settings-repository.js";
import { AssignmentBusinessCapabilityPolicy } from "../core/business-capability-policy.js";
import { UnavailableProductPriceReadAdapter } from "../infrastructure/pricing/local-product-price-read-adapter.js";
import { UnavailableLaborPriceReadAdapter } from "../infrastructure/pricing/local-labor-price-read-adapter.js";
import { UnavailableInventoryReadAdapter } from "../infrastructure/inventory/local-inventory-read-adapter.js";
import type { BusinessOperatorAuthorizer } from "../core/business-operator-authorizer.js";

export type BasicPlanBusinessConfig = {
  businessId: string;
  businessName: string;
  businessType: BusinessType;
  timezone: string;
};

export type BasicPlanRuntimeOptions = {
  databasePath: string;
  interpreter: MessageInterpreter;
  business: BasicPlanBusinessConfig;
  businessOperatorAuthorizer: BusinessOperatorAuthorizer;
  evolutionGoWebhookCredential?: EvolutionGoWebhookCredential;
  evolutionGoBaseUrl?: string;
  evolutionGoTextSender?: { sendText(message: EvolutionGoTextMessage): Promise<void> };
  now?: () => string;
};

export type BasicPlanRuntime = {
  server: Server;
  database: ReturnType<typeof createSqliteDatabase>;
  close: () => Promise<void>;
};

export async function createBasicPlanRuntime(
  options: BasicPlanRuntimeOptions,
): Promise<BasicPlanRuntime> {
  if (
    options.evolutionGoWebhookCredential &&
    options.evolutionGoWebhookCredential.businessId !== options.business.businessId
  ) {
    throw new Error("Evolution Go webhook business does not match the configured business");
  }
  if (options.evolutionGoWebhookCredential && !options.evolutionGoTextSender && !options.evolutionGoBaseUrl) {
    throw new Error("Evolution Go base URL is required when the webhook is configured");
  }

  if (options.databasePath !== ":memory:") {
    mkdirSync(dirname(resolve(options.databasePath)), { recursive: true });
  }

  const database = createSqliteDatabase({ filename: options.databasePath });
  const now = options.now ?? (() => new Date().toISOString());
  let server: Server | undefined;

  try {
    const automotiveBusinessRepository = new SqliteAutomotiveBusinessRepository(database);
    const existingBusiness = await automotiveBusinessRepository.findById(options.business.businessId);
    if (existingBusiness === null) {
      const timestamp = now();
      const business: AutomotiveBusiness = {
        id: options.business.businessId,
        name: options.business.businessName,
        businessType: options.business.businessType,
        timezone: options.business.timezone,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await automotiveBusinessRepository.save(business);
    } else if (
      existingBusiness.name !== options.business.businessName ||
      existingBusiness.businessType !== options.business.businessType ||
      existingBusiness.timezone !== options.business.timezone
    ) {
      throw new Error("Configured business does not match the existing business");
    }

    const conversationRepository = new SqliteConversationRepository(database);
    const messageRepository = new SqliteMessageRepository(database);
    const outboundDeliveryRepository = new SqliteOutboundDeliveryRepository(database);
    const customerRepository = new SqliteCustomerRepository(database);
    const vehicleRepository = new SqliteVehicleRepository(database);
    const opportunityRepository = new SqliteOpportunityRepository(database);
    const quoteRequestRepository = new SqliteQuoteRequestRepository(database);
    const commercialEventRepository = new SqliteCommercialEventRepository(database);
    const stockCheckRepository = new SqliteStockCheckRepository(database);
    const evolutionGoWebhookReplayGuard = new SqliteEvolutionGoWebhookReplayGuard(database);
    const evolutionGoConversationLinkRepository = new SqliteEvolutionGoConversationLinkRepository(database);
    const evolutionGoTextSender = options.evolutionGoWebhookCredential
      ? options.evolutionGoTextSender ?? new EvolutionGoTextSender({
          baseUrl: options.evolutionGoBaseUrl!,
          instanceToken: options.evolutionGoWebhookCredential.instanceToken,
        })
      : undefined;

    server = createBasicPlanHttpServer({
      conversationRepository,
      messageRepository,
      outboundDeliveryRepository,
      customerRepository,
      vehicleRepository,
      opportunityRepository,
      quoteRequestRepository,
      inventoryReadPort: new UnavailableInventoryReadAdapter(),
      stockCheckRepository,
      quoteDraftRepository: new SqliteQuoteDraftRepository(database),
      quoteTransaction: { run: (_businessId, _quoteRequestId, operation) => withSqliteTransaction(database, operation) },
      productPriceReadPort: new UnavailableProductPriceReadAdapter(),
      laborPriceReadPort: new UnavailableLaborPriceReadAdapter(),
      businessCapabilityPolicy: new AssignmentBusinessCapabilityPolicy(new SqliteBusinessPlanAssignmentRepository(database), new SqliteBusinessAssistantIntegrationSettingsRepository(database), { inventory: false, productPricing: false, laborPricing: false }),
      businessOperatorAuthorizer: options.businessOperatorAuthorizer,
      commercialEventRepository,
      evolutionGoWebhookReplayGuard,
      evolutionGoConversationLinkRepository,
      evolutionGoWebhookTransaction: {
        run: (operation) => withSqliteTransaction(database, operation),
      },
      ...(evolutionGoTextSender
        ? {
            evolutionGoTextSender,
            channelTextSenders: { [Channel.WHATSAPP]: evolutionGoTextSender },
          }
        : {}),
      ...(options.evolutionGoWebhookCredential
        ? { evolutionGoWebhookCredentials: [options.evolutionGoWebhookCredential] }
        : {}),
      appointmentRepository: new InMemoryAppointmentRepository(),
      humanHandoffRepository: new InMemoryHumanHandoffRepository(),
      operator: {
        businessId: options.business.businessId,
        businessName: options.business.businessName,
        integratedQuotes: true,
      },
      interpreter: options.interpreter,
      now,
      generateId: (prefix) => `${prefix}-${randomUUID()}`,
    });

    let closePromise: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closePromise ??= (async () => {
        try {
          if (server?.listening) {
            await new Promise<void>((resolveClose, rejectClose) => {
              server!.close((error) => error ? rejectClose(error) : resolveClose());
            });
          }
        } finally {
          database.close();
        }
      })();
      return closePromise;
    };

    return { server, database, close };
  } catch (error) {
    database.close();
    throw error;
  }
}
