import { randomUUID } from "node:crypto";
import { LlmGuard } from "../core/llm-guard.js";
import { OutboundWorker } from "../core/outbound-worker.js";
import { recoverEvolutionGoClaim } from "../channels/whatsapp/evolution-go-claim-recovery.js";
import type { Server } from "node:http";
import type { MessageInterpreter } from "../core/message-interpreter.js";
import type { EvolutionGoWebhookCredential } from "../channels/whatsapp/evolution-go-webhook-auth.js";
import { EvolutionGoTextSender, type EvolutionGoTextMessage } from "../channels/whatsapp/evolution-go-text-sender.js";
import { createBasicPlanHttpServer, notifyWorkshopOfHandoff, type BasicPlanHttpServerDependencies, type BasicPlanOperationalEvent } from "../infrastructure/http/basic-plan-http-server.js";
import { PostgresDatabase, type PostgresEnvironment } from "../infrastructure/postgres/postgres-database.js";
import {
  PostgresAutomotiveBusinessRepository, PostgresCommercialEventRepository,
  PostgresAppointmentRepository, PostgresConversationRepository, PostgresCustomerRepository,
  PostgresEvolutionGoConversationLinkRepository, PostgresEvolutionGoWebhookReplayGuard, PostgresMessageRepository,
  PostgresHumanHandoffRepository, PostgresOpportunityRepository, PostgresQuoteRequestRepository, PostgresVehicleRepository,
  PostgresOutboundDeliveryRepository,
} from "../infrastructure/postgres/postgres-repositories.js";
import { PostgresBusinessProfileRepository } from "../infrastructure/postgres/postgres-business-profile-repository.js";
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
import type { AiUsageBillingConfig, AiUsageRecorder } from "../core/ai-usage.js";
import { AiUsageMeasurementService } from "../core/ai-usage.js";
import { PostgresAiUsageRepository } from "../infrastructure/postgres/postgres-ai-usage-repository.js";
import { PostgresSubscriptionRepository } from "../infrastructure/postgres/postgres-subscription-repository.js";
import { PostgresPaymentTransactionRepository } from "../infrastructure/postgres/postgres-payment-transaction-repository.js";
import { PostgresBusinessBillingProfileRepository } from "../infrastructure/postgres/postgres-business-billing-profile-repository.js";
import { MockPaymentProvider } from "../integrations/payment/mock-payment-provider.js";
import type { PaymentProvider } from "../core/payment-provider.js";
import { SubscriptionService } from "../core/subscription-service.js";
import { BusinessBillingProfileService } from "../core/business-billing-profile.js";
import { PostgresPaymentWebhookEventRepository } from "../infrastructure/postgres/postgres-payment-webhook-event-repository.js";
import { MercadoPagoWebhookService } from "../core/mercado-pago-webhook-service.js";
import { paymentProviderReadApi } from "../core/payment-provider.js";
import { MercadoPagoWebhookVerifier } from "../integrations/payment/mercado-pago-webhook-verifier.js";
import type { MercadoPagoEnvironment } from "../config/payment-environment.js";
import type { Logger } from "../infrastructure/logger.js";

export type BasicPlanPostgresRuntimeOptions = {
  postgres: PostgresEnvironment;
  postgresSearchPathForTests?: string;
  llmDailyCallsPerBusiness?: number;
  publicOrigin?: string;
  privacyContact?: string;
  logger?: Logger;
  business: { businessId: string; businessName: string; businessType: BusinessType; timezone: string };
  businessOperatorAuthorizer: BusinessOperatorAuthorizer;
  interpreter?: MessageInterpreter;
  interpreterFactory?: (usageRecorder: AiUsageRecorder) => MessageInterpreter;
  aiUsageBilling?: AiUsageBillingConfig;
  paymentProvider?: PaymentProvider;
  mercadoPagoEnvironment?: MercadoPagoEnvironment;
  paymentWebhookSecret?: string;
  paymentPayerEmailResolver?: (businessId: string) => Promise<string | null>;
  evolutionGoWebhookCredential?: EvolutionGoWebhookCredential;
  evolutionGoBaseUrl?: string;
  evolutionGoTextSender?: { sendText(message: EvolutionGoTextMessage): Promise<void | { providerMessageId: string }> };
  operationalLog?: (event: BasicPlanOperationalEvent) => void;
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
  const paymentProvider = options.paymentProvider ?? new MockPaymentProvider();
  if (paymentProvider.name === "mercadopago" && options.mercadoPagoEnvironment === undefined) {
    throw new Error("MERCADO_PAGO_ENVIRONMENT is required for the Mercado Pago runtime");
  }
  const database = new PostgresDatabase(options.postgres, {
    ...(options.allowInsecureLocalForTests === undefined ? {} : { allowInsecureLocal: options.allowInsecureLocalForTests }),
    ...(options.postgresSearchPathForTests === undefined ? {} : { searchPath: options.postgresSearchPathForTests }),
    ...(options.logger ? { onPoolError: (code?: string) => options.logger!.error("Postgres pool error", { errorCode: code }) } : {}),
  });
  let server: Server | undefined;
  try {
    await applyPostgresMigrations(database);
    const now = options.now ?? (() => new Date().toISOString());
    const aiUsageRepository = new PostgresAiUsageRepository(database);
    const aiUsageMeasurement = new AiUsageMeasurementService(
      aiUsageRepository,
      options.aiUsageBilling ?? { markupMultiplier: 1 },
      () => `ai-usage-${randomUUID()}`,
      now,
    );
    const billingProfileService = new BusinessBillingProfileService(new PostgresBusinessBillingProfileRepository(database));
    const subscriptionService = new SubscriptionService({
      subscriptionRepository: new PostgresSubscriptionRepository(database),
      paymentTransactionRepository: new PostgresPaymentTransactionRepository(database),
      paymentProvider,
      generateId: (prefix) => `${prefix}-${randomUUID()}`,
      generateIdempotencyKey: () => `payment-${randomUUID()}`,
      now,
    });
    const readApi = paymentProviderReadApi(paymentProvider);
    const mercadoPagoWebhookService = options.paymentWebhookSecret && readApi
      ? new MercadoPagoWebhookService({
          webhookEvents: new PostgresPaymentWebhookEventRepository(database),
          subscriptions: new PostgresSubscriptionRepository(database),
          transactions: new PostgresPaymentTransactionRepository(database),
          assignments: new PostgresBusinessPlanAssignmentRepository(database),
          provider: readApi,
          transaction: { run: (operation) => database.transaction(async () => operation()) },
          now,
          generateId: (prefix) => `${prefix}-${randomUUID()}`,
          ...(options.mercadoPagoEnvironment === undefined ? {} : { mercadoPagoEnvironment: options.mercadoPagoEnvironment }),
        })
      : undefined;
    const interpreter = options.interpreterFactory?.(aiUsageMeasurement) ?? options.interpreter;
    if (interpreter === undefined) throw new Error("An interpreter or interpreterFactory is required");
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

    const generateId = (prefix: string): string => `${prefix}-${randomUUID()}`;
    const businessProfileRepository = new PostgresBusinessProfileRepository(database);
    const messageRepository = new PostgresMessageRepository(database);
    const conversationRepository = new PostgresConversationRepository(database);
    const outboundDeliveryRepository = new PostgresOutboundDeliveryRepository(database);
    const evolutionGoWebhookReplayGuard = new PostgresEvolutionGoWebhookReplayGuard(database);
    const evolutionGoConversationLinkRepository = new PostgresEvolutionGoConversationLinkRepository(database);
    const evolutionGoWebhookTransaction = { run: <T>(operation: () => Promise<T>) => database.transaction(async () => operation()) };

    const serverDependencies: BasicPlanHttpServerDependencies = {
      conversationRepository,
      messageRepository,
      businessProfileRepository,
      businessRepository,
      outboundDeliveryRepository,
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
      evolutionGoWebhookReplayGuard,
      evolutionGoConversationLinkRepository,
      evolutionGoWebhookTransaction,
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
      aiUsageQueryService: aiUsageRepository,
      subscriptionService,
      paymentPayerEmailResolver: options.paymentPayerEmailResolver ?? ((businessId) => billingProfileService.resolvePayerEmail(businessId)),
      ...(mercadoPagoWebhookService && options.paymentWebhookSecret ? {
        mercadoPagoWebhookVerifier: new MercadoPagoWebhookVerifier(options.paymentWebhookSecret),
        mercadoPagoWebhookService,
      } : {}),
      interpreter,
      llmGuard: new LlmGuard({
        now,
        ...(options.llmDailyCallsPerBusiness === undefined ? {} : { dailyCallsPerBusiness: options.llmDailyCallsPerBusiness }),
        countCallsSince: (businessId, since) => aiUsageRepository.countCallsSince(businessId, since),
      }),
      ...(options.operationalLog ? { operationalLog: options.operationalLog } : {}),
      ...(options.publicOrigin ? { publicOrigin: options.publicOrigin } : {}),
      ...(options.privacyContact ? { privacyContact: options.privacyContact } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
      readiness: async () => { await database.query("SELECT 1"); },
      now,
      generateId,
    };
    server = createBasicPlanHttpServer(serverDependencies);
    const credential = options.evolutionGoWebhookCredential;
    const outboundWorker = credential && evolutionGoTextSender
      ? new OutboundWorker({
          scope: { businessId: credential.businessId, instanceName: credential.instanceName },
          channel: Channel.WHATSAPP,
          deliveries: outboundDeliveryRepository,
          replies: evolutionGoWebhookReplayGuard,
          claims: {
            listExpiredClaims: (scope, at, limit) => evolutionGoWebhookReplayGuard.listExpiredClaims(scope, at, limit),
            recover: (claim) => recoverEvolutionGoClaim(claim, {
              replayGuard: evolutionGoWebhookReplayGuard,
              linkRepository: evolutionGoConversationLinkRepository,
              transaction: evolutionGoWebhookTransaction,
              processDependencies: serverDependencies,
              onHandoffOpened: (businessId) => notifyWorkshopOfHandoff(businessId, serverDependencies),
            }),
          },
          conversations: conversationRepository,
          messageRepository,
          handoffs: {
            humanHandoffRepository: serverDependencies.humanHandoffRepository,
            conversationRepository,
            messageRepository,
            customerRepository: serverDependencies.customerRepository,
            businessProfileRepository,
            businessRepository,
          },
          resolveRecipient: async (businessId, conversationId) =>
            (await evolutionGoConversationLinkRepository.findByConversation(businessId, conversationId))?.senderJid ?? null,
          sender: evolutionGoTextSender,
          now,
          generateId,
          onError: () => options.operationalLog?.("Outbound worker error"),
          onSendFailed: () => options.operationalLog?.("Evolution send failed"),
          onHandoffOpened: (businessId) => notifyWorkshopOfHandoff(businessId, serverDependencies),
        })
      : undefined;
    outboundWorker?.start();
    let closing: Promise<void> | undefined;
    return { server, database, outboundWorker, close: () => closing ??= (async () => {
      try { await outboundWorker?.stop(); if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((e) => e ? reject(e) : resolve())); }
      finally { await database.close(); }
    })() };
  } catch (error) {
    await database.close();
    throw error;
  }
}
