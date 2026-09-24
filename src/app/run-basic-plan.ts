import OpenAI from "openai";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BusinessType } from "../core/domain/enums.js";
import { GroqMessageInterpreter } from "../integrations/groq-message-interpreter.js";
import { createBasicPlanRuntime } from "./basic-plan-runtime.js";

async function main(): Promise<void> {
  const config = readEnvironment(process.env);
  mkdirSync(dirname(resolve(config.databasePath)), { recursive: true });

  const client = new OpenAI({
    apiKey: config.groqApiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
  const interpreter = new GroqMessageInterpreter(client, config.groqModel);
  const runtime = await createBasicPlanRuntime({
    databasePath: config.databasePath,
    interpreter,
    business: {
      businessId: config.businessId,
      businessName: config.businessName,
      businessType: config.businessType,
      timezone: config.timezone,
    },
  });

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= runtime.close().finally(() => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    });
    return shutdownPromise;
  };
  const onSigint = (): void => {
    void shutdown().catch(() => {
      console.error("Basic Plan shutdown failed");
      process.exitCode = 1;
    });
  };
  const onSigterm = (): void => {
    void shutdown().catch(() => {
      console.error("Basic Plan shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      runtime.server.once("error", rejectListen);
      runtime.server.listen(config.port, config.host, resolveListen);
    });
  } catch (error) {
    await shutdown();
    throw error;
  }

  console.log(`Basic Plan server listening on http://${config.host}:${config.port}`);
}

type RuntimeEnvironment = {
  databasePath: string;
  businessId: string;
  businessName: string;
  businessType: BusinessType;
  timezone: string;
  host: string;
  port: number;
  groqApiKey: string;
  groqModel: string;
};

function readEnvironment(environment: NodeJS.ProcessEnv): RuntimeEnvironment {
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

  return {
    databasePath: environment.BASIC_PLAN_DB_PATH?.trim() || "./data/atendente.db",
    businessId,
    businessName,
    businessType,
    timezone: environment.BASIC_PLAN_TIMEZONE?.trim() || "America/Sao_Paulo",
    host: environment.HOST?.trim() || "127.0.0.1",
    port,
    groqApiKey: required(environment.GROQ_API_KEY, "GROQ_API_KEY"),
    groqModel: required(environment.GROQ_MODEL, "GROQ_MODEL"),
  };
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Basic Plan startup failed");
  process.exitCode = 1;
});
