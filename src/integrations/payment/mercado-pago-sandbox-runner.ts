import { createHash, randomUUID } from "node:crypto";
import { BusinessType } from "../../core/domain/enums.js";
import { BusinessBillingProfileService, normalizePayerEmail } from "../../core/business-billing-profile.js";
import { getPaymentCatalogEntry } from "../../core/payment-catalog.js";
import { PaymentTransactionType } from "../../core/payment-transaction.js";
import type { PaymentProvider } from "../../core/payment-provider.js";
import { SubscriptionService, type StartSubscriptionResult } from "../../core/subscription-service.js";
import { MercadoPagoEnvironment, readPaymentEnvironment, type PaymentEnvironment } from "../../config/payment-environment.js";
import { createPaymentProvider } from "./create-payment-provider.js";
import { PostgresBusinessBillingProfileRepository } from "../../infrastructure/postgres/postgres-business-billing-profile-repository.js";
import { PostgresPaymentTransactionRepository } from "../../infrastructure/postgres/postgres-payment-transaction-repository.js";
import { PostgresSubscriptionRepository } from "../../infrastructure/postgres/postgres-subscription-repository.js";
import { PostgresAutomotiveBusinessRepository } from "../../infrastructure/postgres/postgres-repositories.js";
import { applyPostgresMigrations } from "../../infrastructure/postgres/postgres-migrations.js";
import { PostgresDatabase, type PostgresEnvironment } from "../../infrastructure/postgres/postgres-database.js";

export const MERCADO_PAGO_SANDBOX_BUSINESS_ID = "sandbox-mp-business";
export const MERCADO_PAGO_SANDBOX_BUSINESS_NAME = "Mercado Pago Sandbox";
export const MERCADO_PAGO_SANDBOX_TIMEZONE = "America/Sao_Paulo";
export const MERCADO_PAGO_SANDBOX_PLAN = "INTERMEDIATE" as const;
export const MERCADO_PAGO_SANDBOX_BILLING_CYCLE = "MONTHLY" as const;

export type SandboxSmokeSafety = {
  payerEmail: string;
  runId?: string;
  dryRun: boolean;
};

export type SandboxSmokeReport = {
  subscriptionId?: string;
  plan: string;
  billingCycle: string;
  setupFeeCents: number;
  subscriptionAmountCents: number;
  providerSubscriptionId?: string;
  providerSetupPaymentId?: string;
  checkoutUrls: { subscription?: string; setup?: string };
  status: string;
  dryRun: boolean;
  reused: boolean;
};

export type SandboxSmokeDependencies = {
  createDatabase?: (config: PostgresEnvironment) => PostgresDatabase;
  migrate?: (database: PostgresDatabase) => Promise<readonly string[]>;
  createPaymentProvider?: (environment: PaymentEnvironment) => PaymentProvider;
  now?: () => string;
};

export function sandboxPostgresConfig(environment: NodeJS.ProcessEnv): PostgresEnvironment {
  return {
    host: "127.0.0.1",
    port: 55432,
    database: "atendente24h_test",
    user: "test_user",
    password: environment.POSTGRES_TEST_PASSWORD?.trim() ?? "",
  };
}

export function assertSandboxSafety(environment: NodeJS.ProcessEnv, options: { requireRunId: boolean }): SandboxSmokeSafety {
  const mercadoPagoEnvironment = environment.MERCADO_PAGO_ENVIRONMENT?.trim();
  if (mercadoPagoEnvironment === MercadoPagoEnvironment.PRODUCTION) {
    throw new Error("Mercado Pago sandbox runner refuses MERCADO_PAGO_ENVIRONMENT=production");
  }
  if (mercadoPagoEnvironment !== MercadoPagoEnvironment.TEST) {
    throw new Error("Mercado Pago sandbox runner requires MERCADO_PAGO_ENVIRONMENT=test");
  }
  if (environment.MERCADO_PAGO_SANDBOX_CONFIRM?.trim() !== "YES") {
    throw new Error("MERCADO_PAGO_SANDBOX_CONFIRM=YES is required for the Mercado Pago sandbox runner");
  }
  const payerEmail = normalizePayerEmail(requiredEnvironmentValue(environment.MERCADO_PAGO_TEST_PAYER_EMAIL, "MERCADO_PAGO_TEST_PAYER_EMAIL"));
  const runId = environment.MERCADO_PAGO_SANDBOX_RUN_ID?.trim() || undefined;
  if (options.requireRunId && runId === undefined) throw new Error("MERCADO_PAGO_SANDBOX_RUN_ID is required for the Mercado Pago sandbox smoke");
  return {
    payerEmail,
    ...(runId === undefined ? {} : { runId }),
    dryRun: environment.MERCADO_PAGO_SANDBOX_DRY_RUN?.trim().toLowerCase() === "true",
  };
}

export function sandboxSmokeIdempotencyKey(runId: string): string {
  const normalized = runId.trim();
  if (!normalized) throw new Error("MERCADO_PAGO_SANDBOX_RUN_ID is required for the Mercado Pago sandbox smoke");
  return createHash("sha256").update(`mercadopago-sandbox:${normalized}`).digest("hex");
}

export function formatSandboxSmokeReport(report: SandboxSmokeReport): string {
  return [
    `subscription local ID: ${report.subscriptionId ?? "(not created in dry-run)"}`,
    `plano: ${report.plan}`,
    `ciclo: ${report.billingCycle}`,
    `valor esperado de setup: ${formatBrl(report.setupFeeCents)}`,
    `valor esperado da assinatura: ${formatBrl(report.subscriptionAmountCents)}`,
    `provider subscription ID: ${report.providerSubscriptionId ?? "(not created in dry-run)"}`,
    `provider setup payment ID: ${report.providerSetupPaymentId ?? "(not created in dry-run)"}`,
    `URL de checkout da assinatura: ${report.checkoutUrls.subscription ?? "(not returned)"}`,
    `URL de checkout da implantacao: ${report.checkoutUrls.setup ?? "(not returned)"}`,
    `status local: ${report.status}${report.dryRun ? " (dry-run)" : ""}`,
  ].join("\n");
}

export function redactSandboxError(error: unknown, environment: NodeJS.ProcessEnv): string {
  const message = error instanceof Error && error.message.trim() ? error.message : "Mercado Pago sandbox operation failed";
  return [
    environment.MERCADO_PAGO_ACCESS_TOKEN,
    environment.MERCADO_PAGO_WEBHOOK_SECRET,
    environment.POSTGRES_TEST_PASSWORD,
    environment.MERCADO_PAGO_TEST_PAYER_EMAIL,
  ].filter((value): value is string => Boolean(value?.trim())).reduce(
    (safe, secret) => safe.split(secret).join("[redacted]"),
    message,
  );
}

export async function prepareMercadoPagoSandboxBusiness(environment: NodeJS.ProcessEnv = process.env): Promise<{ created: boolean; payerEmail: string }> {
  const safety = assertSandboxSafety(environment, { requireRunId: false });
  const database = new PostgresDatabase(sandboxPostgresConfig(environment), { allowInsecureLocal: true });
  try {
    await applyPostgresMigrations(database);
    const businesses = new PostgresAutomotiveBusinessRepository(database);
    const current = await businesses.findById(MERCADO_PAGO_SANDBOX_BUSINESS_ID);
    let created = false;
    if (current === null) {
      const timestamp = new Date().toISOString();
      await businesses.save({
        id: MERCADO_PAGO_SANDBOX_BUSINESS_ID,
        name: MERCADO_PAGO_SANDBOX_BUSINESS_NAME,
        businessType: BusinessType.WORKSHOP,
        timezone: MERCADO_PAGO_SANDBOX_TIMEZONE,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      created = true;
    } else if (current.name !== MERCADO_PAGO_SANDBOX_BUSINESS_NAME || current.businessType !== BusinessType.WORKSHOP || current.timezone !== MERCADO_PAGO_SANDBOX_TIMEZONE || !current.active) {
      throw new Error("Existing sandbox business does not match the dedicated Mercado Pago test business");
    }
    const billingProfiles = new BusinessBillingProfileService(new PostgresBusinessBillingProfileRepository(database));
    await billingProfiles.save({ businessId: MERCADO_PAGO_SANDBOX_BUSINESS_ID, payerEmail: safety.payerEmail, now: new Date().toISOString() });
    return { created, payerEmail: safety.payerEmail };
  } finally {
    await database.close();
  }
}

export async function runMercadoPagoSandboxSmoke(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: SandboxSmokeDependencies = {},
): Promise<SandboxSmokeReport> {
  const safety = assertSandboxSafety(environment, { requireRunId: true });
  const paymentEnvironment = readPaymentEnvironment(environment);
  if (paymentEnvironment.mode !== "mercadopago" || paymentEnvironment.mercadoPagoEnvironment !== MercadoPagoEnvironment.TEST) {
    throw new Error("Sandbox smoke requires PAYMENT_MODE=mercadopago and MERCADO_PAGO_ENVIRONMENT=test");
  }
  const catalog = getPaymentCatalogEntry(MERCADO_PAGO_SANDBOX_PLAN, MERCADO_PAGO_SANDBOX_BILLING_CYCLE);
  const database = dependencies.createDatabase?.(sandboxPostgresConfig(environment))
    ?? new PostgresDatabase(sandboxPostgresConfig(environment), { allowInsecureLocal: true });
  try {
    await (dependencies.migrate ?? applyPostgresMigrations)(database);
    const business = await new PostgresAutomotiveBusinessRepository(database).findById(MERCADO_PAGO_SANDBOX_BUSINESS_ID);
    if (business === null) throw new Error("Sandbox business does not exist; run npm run sandbox:mp-business first");
    if (business.name !== MERCADO_PAGO_SANDBOX_BUSINESS_NAME || business.businessType !== BusinessType.WORKSHOP || !business.active) {
      throw new Error("Sandbox business is not the dedicated Mercado Pago test business");
    }
    const billingProfiles = new BusinessBillingProfileService(new PostgresBusinessBillingProfileRepository(database));
    const persistedPayerEmail = await billingProfiles.resolvePayerEmail(MERCADO_PAGO_SANDBOX_BUSINESS_ID);
    if (persistedPayerEmail === null) throw new Error("Sandbox billing profile is not configured");
    if (persistedPayerEmail !== safety.payerEmail) throw new Error("MERCADO_PAGO_TEST_PAYER_EMAIL does not match the persisted sandbox billing profile");

    if (safety.dryRun) {
      return {
        plan: catalog.plan,
        billingCycle: catalog.billingCycle,
        setupFeeCents: catalog.setupFeeCents,
        subscriptionAmountCents: catalog.subscriptionAmountCents,
        checkoutUrls: {},
        status: "DRY_RUN",
        dryRun: true,
        reused: false,
      };
    }

    const provider = dependencies.createPaymentProvider?.(paymentEnvironment) ?? createPaymentProvider(paymentEnvironment);
    const now = dependencies.now ?? (() => new Date().toISOString());
    const subscriptions = new PostgresSubscriptionRepository(database);
    const transactions = new PostgresPaymentTransactionRepository(database);
    const service = new SubscriptionService({
      subscriptionRepository: subscriptions,
      paymentTransactionRepository: transactions,
      paymentProvider: provider,
      generateId: (prefix) => `${prefix}-${randomUUID()}`,
      generateIdempotencyKey: () => `sandbox-${randomUUID()}`,
      now,
    });
    const result = await service.start({
      businessId: MERCADO_PAGO_SANDBOX_BUSINESS_ID,
      plan: MERCADO_PAGO_SANDBOX_PLAN,
      billingCycle: MERCADO_PAGO_SANDBOX_BILLING_CYCLE,
      payerEmail: persistedPayerEmail,
      idempotencyKey: sandboxSmokeIdempotencyKey(safety.runId!),
    });
    return reportFromSubscriptionResult(result, false);
  } finally {
    await database.close();
  }
}

function reportFromSubscriptionResult(result: StartSubscriptionResult, dryRun: boolean): SandboxSmokeReport {
  const setup = result.transactions.find((transaction) => transaction.type === PaymentTransactionType.SETUP_FEE);
  return {
    subscriptionId: result.subscription.id,
    plan: result.subscription.plan,
    billingCycle: result.subscription.billingCycle,
    setupFeeCents: result.subscription.setupFeeCents,
    subscriptionAmountCents: result.subscription.subscriptionAmountCents,
    ...(result.subscription.providerSubscriptionId === undefined ? {} : { providerSubscriptionId: result.subscription.providerSubscriptionId }),
    ...(setup?.providerPaymentId === undefined ? {} : { providerSetupPaymentId: setup.providerPaymentId }),
    checkoutUrls: result.checkoutUrls,
    status: result.subscription.status,
    dryRun,
    reused: result.reused,
  };
}

function requiredEnvironmentValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required for the Mercado Pago sandbox runner`);
  return normalized;
}

function formatBrl(cents: number): string {
  return `BRL ${(cents / 100).toFixed(2)}`;
}
