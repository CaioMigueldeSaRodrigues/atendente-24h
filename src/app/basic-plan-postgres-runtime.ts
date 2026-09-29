import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { MessageInterpreter } from "../core/message-interpreter.js";
import type { EvolutionGoWebhookCredential } from "../channels/whatsapp/evolution-go-webhook-auth.js";
import { createBasicPlanHttpServer } from "../infrastructure/http/basic-plan-http-server.js";
import { PostgresDatabase, type PostgresEnvironment } from "../infrastructure/postgres/postgres-database.js";
import {
  PostgresAutomotiveBusinessRepository, PostgresCommercialEventRepository,
  PostgresAppointmentRepository, PostgresConversationRepository, PostgresCustomerRepository,
  PostgresEvolutionGoConversationLinkRepository, PostgresEvolutionGoWebhookReplayGuard, PostgresMessageRepository,
  PostgresHumanHandoffRepository, PostgresOpportunityRepository, PostgresQuoteRequestRepository, PostgresVehicleRepository,
} from "../infrastructure/postgres/postgres-repositories.js";
import { applyPostgresMigrations } from "../infrastructure/postgres/postgres-migrations.js";
import type { BusinessType } from "../core/domain/enums.js";

export type BasicPlanPostgresRuntimeOptions = {
  postgres: PostgresEnvironment;
  business: { businessId: string; businessName: string; businessType: BusinessType; timezone: string };
  interpreter: MessageInterpreter;
  evolutionGoWebhookCredential?: EvolutionGoWebhookCredential;
  now?: () => string;
  allowInsecureLocalForTests?: boolean;
};

export async function createBasicPlanPostgresRuntime(options: BasicPlanPostgresRuntimeOptions) {
  if (options.evolutionGoWebhookCredential && options.evolutionGoWebhookCredential.businessId !== options.business.businessId) {
    throw new Error("Evolution Go webhook business does not match the configured business");
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

    server = createBasicPlanHttpServer({
      conversationRepository: new PostgresConversationRepository(database),
      messageRepository: new PostgresMessageRepository(database),
      customerRepository: new PostgresCustomerRepository(database),
      vehicleRepository: new PostgresVehicleRepository(database),
      opportunityRepository: new PostgresOpportunityRepository(database),
      quoteRequestRepository: new PostgresQuoteRequestRepository(database),
      commercialEventRepository: new PostgresCommercialEventRepository(database),
      evolutionGoWebhookReplayGuard: new PostgresEvolutionGoWebhookReplayGuard(database),
      evolutionGoConversationLinkRepository: new PostgresEvolutionGoConversationLinkRepository(database),
      ...(options.evolutionGoWebhookCredential ? { evolutionGoWebhookCredentials: [options.evolutionGoWebhookCredential] } : {}),
      appointmentRepository: new PostgresAppointmentRepository(database),
      humanHandoffRepository: new PostgresHumanHandoffRepository(database),
      operator: { businessId: options.business.businessId, businessName: options.business.businessName },
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
