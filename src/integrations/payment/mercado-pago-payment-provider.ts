import type { PaymentProvider, ProviderIntentResult, ProviderSetupFeeIntent, ProviderSubscriptionIntent } from "../../core/payment-provider.js";
import { PaymentTransactionStatus } from "../../core/payment-transaction.js";

const MERCADO_PAGO_API_BASE_URL = "https://api.mercadopago.com";

export type MercadoPagoHttpRequest = {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
};

export type MercadoPagoHttpResponse = {
  status: number;
  json(): Promise<unknown>;
};

export type MercadoPagoHttpClient = (request: MercadoPagoHttpRequest) => Promise<MercadoPagoHttpResponse>;

export class MercadoPagoProviderError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(`Mercado Pago request failed with HTTP ${statusCode}`);
    this.name = "MercadoPagoProviderError";
    this.statusCode = statusCode;
  }
}

export type MercadoPagoPaymentProviderOptions = {
  accessToken: string;
  backUrl: string;
  httpClient?: MercadoPagoHttpClient;
};

export class MercadoPagoPaymentProvider implements PaymentProvider {
  readonly name = "mercadopago" as const;
  private readonly httpClient: MercadoPagoHttpClient;

  constructor(private readonly options: MercadoPagoPaymentProviderOptions) {
    if (!options.accessToken.trim()) throw new Error("Mercado Pago access token is required");
    if (!options.backUrl.trim()) throw new Error("Mercado Pago back URL is required");
    this.httpClient = options.httpClient ?? defaultHttpClient;
  }

  async createSubscriptionIntent(input: ProviderSubscriptionIntent): Promise<ProviderIntentResult> {
    const response = await this.request("/preapproval", input.idempotencyKey, {
      payer_email: input.payerEmail,
      reason: `Atendente 24h - ${input.plan} ${input.billingCycle}`,
      external_reference: input.externalReference,
      auto_recurring: {
        frequency: input.billingCycle === "MONTHLY" ? 1 : 12,
        frequency_type: "months",
        transaction_amount: input.catalog.subscriptionAmountCents / 100,
        currency_id: "BRL",
      },
      back_url: this.options.backUrl,
    });
    return {
      status: providerStatus(response.status),
      ...optionalField("providerSubscriptionId", stringField(response.body, "id")),
      ...optionalField("checkoutUrl", stringField(response.body, "init_point")),
      ...optionalField("externalReference", stringField(response.body, "external_reference")),
      ...optionalField("providerStatus", stringField(response.body, "status")),
    };
  }

  async createSetupFeeIntent(input: ProviderSetupFeeIntent): Promise<ProviderIntentResult> {
    const response = await this.request("/checkout/preferences", input.idempotencyKey, {
      items: [{
        id: input.externalReference,
        title: "Taxa de implantação Atendente 24h",
        quantity: 1,
        currency_id: "BRL",
        unit_price: input.catalog.setupFeeCents / 100,
      }],
      payer: { email: input.payerEmail },
      external_reference: input.externalReference,
      back_urls: {
        success: this.options.backUrl,
        pending: this.options.backUrl,
        failure: this.options.backUrl,
      },
    });
    return {
      status: providerStatus(response.status),
      ...optionalField("providerPaymentId", stringField(response.body, "id")),
      ...optionalField("checkoutUrl", stringField(response.body, "init_point")),
      ...optionalField("externalReference", stringField(response.body, "external_reference")),
      ...optionalField("providerStatus", stringField(response.body, "status")),
    };
  }

  private async request(path: string, idempotencyKey: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await this.httpClient({
      method: "POST",
      url: `${MERCADO_PAGO_API_BASE_URL}${path}`,
      headers: {
        Authorization: `Bearer ${this.options.accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    if (response.status < 200 || response.status >= 300) {
      // The provider response is deliberately not included: it may contain payer or credential-related data.
      throw new MercadoPagoProviderError(response.status);
    }
    const payload = await response.json();
    if (!isRecord(payload)) throw new MercadoPagoProviderError(response.status);
    return { status: response.status, body: payload };
  }
}

const defaultHttpClient: MercadoPagoHttpClient = async (request) => {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
  return { status: response.status, json: () => response.json() as Promise<unknown> };
};

function providerStatus(httpStatus: number): PaymentTransactionStatus {
  return httpStatus >= 200 && httpStatus < 300 ? PaymentTransactionStatus.PENDING : PaymentTransactionStatus.FAILED;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" && value[key].trim() ? value[key] : undefined;
}

function optionalField(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
