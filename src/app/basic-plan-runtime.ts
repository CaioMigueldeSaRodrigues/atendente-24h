import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Server } from "node:http";
import type { AutomotiveBusiness } from "../core/domain/entities.js";
import type { BusinessType } from "../core/domain/enums.js";
import type { MessageInterpreter } from "../core/message-interpreter.js";
import {
  InMemoryAppointmentRepository,
  InMemoryHumanHandoffRepository,
} from "../core/in-memory-repositories.js";
import { createBasicPlanHttpServer } from "../infrastructure/http/basic-plan-http-server.js";
import { createSqliteDatabase } from "../infrastructure/sqlite/sqlite-database.js";
import { SqliteAutomotiveBusinessRepository } from "../infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteCustomerRepository } from "../infrastructure/sqlite/sqlite-customer-repository.js";
import { SqliteMessageRepository } from "../infrastructure/sqlite/sqlite-message-repository.js";
import { SqliteOpportunityRepository } from "../infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteQuoteRequestRepository } from "../infrastructure/sqlite/sqlite-quote-request-repository.js";
import { SqliteVehicleRepository } from "../infrastructure/sqlite/sqlite-vehicle-repository.js";

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
    const customerRepository = new SqliteCustomerRepository(database);
    const vehicleRepository = new SqliteVehicleRepository(database);
    const opportunityRepository = new SqliteOpportunityRepository(database);
    const quoteRequestRepository = new SqliteQuoteRequestRepository(database);

    server = createBasicPlanHttpServer({
      conversationRepository,
      messageRepository,
      customerRepository,
      vehicleRepository,
      opportunityRepository,
      quoteRequestRepository,
      appointmentRepository: new InMemoryAppointmentRepository(),
      humanHandoffRepository: new InMemoryHumanHandoffRepository(),
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
