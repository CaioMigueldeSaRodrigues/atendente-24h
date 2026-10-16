export const PaymentMode = {
  MOCK: "mock",
  MERCADO_PAGO: "mercadopago",
} as const;

export type PaymentMode = typeof PaymentMode[keyof typeof PaymentMode];

export const MercadoPagoEnvironment = {
  TEST: "test",
  PRODUCTION: "production",
} as const;

export type MercadoPagoEnvironment = typeof MercadoPagoEnvironment[keyof typeof MercadoPagoEnvironment];

export type PaymentEnvironment = {
  mode: PaymentMode;
  mercadoPagoEnvironment?: MercadoPagoEnvironment;
  mercadoPagoAccessToken?: string;
  mercadoPagoWebhookSecret?: string;
  mercadoPagoBackUrl?: string;
};

export function readPaymentEnvironment(environment: NodeJS.ProcessEnv): PaymentEnvironment {
  const mode = environment.PAYMENT_MODE?.trim() || PaymentMode.MOCK;
  if (mode !== PaymentMode.MOCK && mode !== PaymentMode.MERCADO_PAGO) {
    throw new Error("PAYMENT_MODE must be mock or mercadopago");
  }
  if (mode === PaymentMode.MOCK) return { mode: PaymentMode.MOCK };
  const mercadoPagoEnvironment = requiredEnvironment(environment.MERCADO_PAGO_ENVIRONMENT);
  const accessToken = required(environment.MERCADO_PAGO_ACCESS_TOKEN, "MERCADO_PAGO_ACCESS_TOKEN");
  const webhookSecret = required(environment.MERCADO_PAGO_WEBHOOK_SECRET, "MERCADO_PAGO_WEBHOOK_SECRET");
  const backUrl = requiredHttpsUrl(environment.MERCADO_PAGO_BACK_URL, "MERCADO_PAGO_BACK_URL");
  return { mode, mercadoPagoEnvironment, mercadoPagoAccessToken: accessToken, mercadoPagoWebhookSecret: webhookSecret, mercadoPagoBackUrl: backUrl };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required when PAYMENT_MODE=mercadopago`);
  return normalized;
}

function requiredEnvironment(value: string | undefined): MercadoPagoEnvironment {
  const normalized = value?.trim();
  if (normalized !== MercadoPagoEnvironment.TEST && normalized !== MercadoPagoEnvironment.PRODUCTION) {
    throw new Error("MERCADO_PAGO_ENVIRONMENT must be test or production when PAYMENT_MODE=mercadopago");
  }
  return normalized;
}

function requiredHttpsUrl(value: string | undefined, name: string): string {
  const normalized = required(value, name);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) throw new Error(`${name} must be a valid HTTPS URL`);
  return parsed.toString();
}
