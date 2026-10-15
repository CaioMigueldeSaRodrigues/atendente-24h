export const PaymentMode = {
  MOCK: "mock",
  MERCADO_PAGO: "mercadopago",
} as const;

export type PaymentMode = typeof PaymentMode[keyof typeof PaymentMode];

export type PaymentEnvironment = {
  mode: PaymentMode;
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
  const accessToken = required(environment.MERCADO_PAGO_ACCESS_TOKEN, "MERCADO_PAGO_ACCESS_TOKEN");
  const webhookSecret = required(environment.MERCADO_PAGO_WEBHOOK_SECRET, "MERCADO_PAGO_WEBHOOK_SECRET");
  const backUrl = required(environment.MERCADO_PAGO_BACK_URL, "MERCADO_PAGO_BACK_URL");
  return { mode, mercadoPagoAccessToken: accessToken, mercadoPagoWebhookSecret: webhookSecret, mercadoPagoBackUrl: backUrl };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required when PAYMENT_MODE=mercadopago`);
  return normalized;
}
