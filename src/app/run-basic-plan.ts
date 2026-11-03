import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BusinessType } from "../core/domain/enums.js";
import { createRuntimeMessageInterpreter, isGate3FakeInterpreterEnabled } from "./runtime-message-interpreter.js";
import { createBasicPlanRuntime } from "./basic-plan-runtime.js";
import { createBasicPlanPostgresRuntime } from "./basic-plan-postgres-runtime.js";
import { isPostgresInsecureLocalEnabled, postgresConfigFromEnvironment } from "../infrastructure/postgres/postgres-database.js";
import { readEvolutionGoWebhookCredential } from "./evolution-go-webhook-environment.js";
import { BasicBusinessOperatorAuthorizer } from "../infrastructure/http/basic-business-operator-authorizer.js";
import type { BasicPlanOperationalEvent } from "../infrastructure/http/basic-plan-http-server.js";
import { readAiUsageBillingConfig } from "../config/ai-billing-environment.js";
import { readPaymentEnvironment } from "../config/payment-environment.js";
import { createPaymentProvider } from "../integrations/payment/create-payment-provider.js";
import { readLlmDailyCallsPerBusiness } from "../integrations/llm/llm-environment.js";
import { createLogger, errorFields } from "../infrastructure/logger.js";

const SHUTDOWN_LIMIT_MS = 10_000;
const logger = createLogger();

async function main(): Promise<void> {
  const config = readEnvironment(process.env);
  const paymentEnvironment = readPaymentEnvironment(process.env);
  if (isGate3FakeInterpreterEnabled(process.env)) {
    logger.warn("Gate 3 manual mode enabled: deterministic interpreter; external LLM disabled");
  }
  if (config.databaseBackend === "sqlite") mkdirSync(dirname(resolve(config.databasePath)), { recursive: true });

  const common = {
    businessOperatorAuthorizer: new BasicBusinessOperatorAuthorizer(
      config.businessId,
      config.operatorUsername,
      config.operatorPassword,
    ),
    business: {
      businessId: config.businessId,
      businessName: config.businessName,
      businessType: config.businessType,
      timezone: config.timezone,
    },
    ...(config.evolutionGoWebhookCredential ? { evolutionGoWebhookCredential: config.evolutionGoWebhookCredential } : {}),
    ...(config.evolutionGoBaseUrl ? { evolutionGoBaseUrl: config.evolutionGoBaseUrl } : {}),
    ...(config.publicOrigin ? { publicOrigin: config.publicOrigin } : {}),
    ...(config.privacyContact ? { privacyContact: config.privacyContact } : {}),
    logger,
    operationalLog: (event: BasicPlanOperationalEvent): void => logger[/error/i.test(event) ? "error" : /failed/i.test(event) ? "warn" : "info"](event),
  };
  const runtime = config.databaseBackend === "sqlite"
    ? await createBasicPlanRuntime({
        ...common,
        databasePath: config.databasePath,
        interpreter: createRuntimeMessageInterpreter(process.env),
      })
    : await createBasicPlanPostgresRuntime({
        ...common,
        postgres: postgresConfigFromEnvironment(process.env),
        ...(isPostgresInsecureLocalEnabled(process.env) ? { allowInsecureLocalForTests: true } : {}),
        llmDailyCallsPerBusiness: readLlmDailyCallsPerBusiness(process.env),
        aiUsageBilling: readAiUsageBillingConfig(process.env),
        paymentProvider: createPaymentProvider(paymentEnvironment),
        ...(paymentEnvironment.mercadoPagoEnvironment === undefined ? {} : { mercadoPagoEnvironment: paymentEnvironment.mercadoPagoEnvironment }),
        ...(paymentEnvironment.mercadoPagoWebhookSecret ? { paymentWebhookSecret: paymentEnvironment.mercadoPagoWebhookSecret } : {}),
        interpreterFactory: (usageRecorder) => createRuntimeMessageInterpreter(
          process.env,
          usageRecorder,
          (error) => logger.warn("AI usage record failed", errorFields(error)),
        ),
      });

  let shutdownPromise: Promise<void> | undefined;
  // runtime.close() stops the outbound worker first, then the server, then the database; if it hangs, the process leaves anyway.
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      const limit = setTimeout(() => {
        logger.error("Shutdown exceeded its limit");
        process.exit(1);
      }, SHUTDOWN_LIMIT_MS);
      try {
        await runtime.close();
      } finally {
        clearTimeout(limit);
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }
    })();
    return shutdownPromise;
  };
  const onSignal = (): void => {
    void shutdown().catch(() => {
      logger.error("Shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      runtime.server.once("error", rejectListen);
      runtime.server.listen(config.port, config.host, resolveListen);
    });
  } catch (error) {
    await shutdown();
    throw error;
  }

  logger.info("Server listening", { host: config.host, port: config.port });
}

type RuntimeEnvironment = {
  databaseBackend: "sqlite" | "postgres";
  databasePath: string;
  businessId: string;
  businessName: string;
  businessType: BusinessType;
  timezone: string;
  host: string;
  port: number;
  operatorUsername: string;
  operatorPassword: string;
  evolutionGoWebhookCredential?: ReturnType<typeof readEvolutionGoWebhookCredential>;
  evolutionGoBaseUrl?: string;
  publicOrigin?: string;
  privacyContact?: string;
};

function readEnvironment(environment: NodeJS.ProcessEnv): RuntimeEnvironment {
  const databaseBackend = environment.DATABASE_BACKEND?.trim();
  if (databaseBackend !== "sqlite" && databaseBackend !== "postgres") {
    throw new Error("DATABASE_BACKEND must be explicitly set to sqlite or postgres");
  }
  const businessId = required(environment.BASIC_PLAN_BUSINESS_ID, "BASIC_PLAN_BUSINESS_ID");
  const businessName = required(environment.BASIC_PLAN_BUSINESS_NAME, "BASIC_PLAN_BUSINESS_NAME");
  const businessTypeValue = required(environment.BASIC_PLAN_BUSINESS_TYPE, "BASIC_PLAN_BUSINESS_TYPE");
  const businessType = Object.values(BusinessType).find((value) => value === businessTypeValue);
  if (businessType === undefined) {
    throw new Error(`BASIC_PLAN_BUSINESS_TYPE must be one of: ${Object.values(BusinessType).join(", ")}`);
  }

  const portValue = environment.PORT ?? "3000";
  if (!/^\d+$/.test(portValue)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const port = Number(portValue);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  // Both feed the privacy notice every customer is shown, so a PostgreSQL (production) instance does not start without them.
  const publicOrigin = databaseBackend === "postgres" ? required(environment.PUBLIC_ORIGIN, "PUBLIC_ORIGIN") : environment.PUBLIC_ORIGIN?.trim();
  if (publicOrigin && !URL.canParse(publicOrigin)) throw new Error("PUBLIC_ORIGIN must be a valid URL");
  const privacyContact = databaseBackend === "postgres" ? required(environment.PRIVACY_CONTACT, "PRIVACY_CONTACT") : environment.PRIVACY_CONTACT?.trim();

  const evolutionGoWebhookCredential = readEvolutionGoWebhookCredential(environment, businessId);
  const evolutionGoBaseUrl = evolutionGoWebhookCredential
    ? required(environment.EVOLUTION_GO_BASE_URL, "EVOLUTION_GO_BASE_URL")
    : undefined;
  return {
    databaseBackend,
    databasePath: environment.BASIC_PLAN_DB_PATH?.trim() || "./data/atendente.db",
    businessId,
    businessName,
    businessType,
    timezone: environment.BASIC_PLAN_TIMEZONE?.trim() || "America/Sao_Paulo",
    host: environment.HOST?.trim() || "127.0.0.1",
    port,
    operatorUsername: required(environment.BASIC_PLAN_OPERATOR_USERNAME, "BASIC_PLAN_OPERATOR_USERNAME"),
    operatorPassword: required(environment.BASIC_PLAN_OPERATOR_PASSWORD, "BASIC_PLAN_OPERATOR_PASSWORD"),
    ...(evolutionGoWebhookCredential ? { evolutionGoWebhookCredential } : {}),
    ...(evolutionGoBaseUrl ? { evolutionGoBaseUrl } : {}),
    ...(publicOrigin ? { publicOrigin } : {}),
    ...(privacyContact ? { privacyContact } : {}),
  };
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

// A bug nobody caught leaves the process in an unknown state: say so and let the supervisor restart it.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", errorFields(reason));
  process.exit(1);
});
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", errorFields(error));
  process.exit(1);
});

void main().catch((error: unknown) => {
  logger.error("Startup failed", errorFields(error));
  // Startup messages are our own configuration errors ("X is required"), which the operator needs to read.
  console.error(error instanceof Error ? error.message : "Basic Plan startup failed");
  process.exitCode = 1;
});
