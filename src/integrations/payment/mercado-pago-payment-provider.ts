import { PaymentProviderError, PaymentProviderTransientError, type PaymentProvider, type ProviderAuthorizedPaymentResource, type ProviderIntentResult, type ProviderPaymentResource, type ProviderSetupFeeIntent, type ProviderSubscriptionIntent, type ProviderSubscriptionResource } from "../../core/payment-provider.js";
import { PaymentTransactionStatus } from "../../core/payment-transaction.js";

const MERCADO_PAGO_API_BASE_URL = "https://api.mercadopago.com";

export type MercadoPagoHttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export type MercadoPagoHttpResponse = {
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
};

export type MercadoPagoHttpClient = (request: MercadoPagoHttpRequest) => Promise<MercadoPagoHttpResponse>;

export type MercadoPagoSafeErrorDetails = {
  error?: string;
  message?: string;
  causeCodes: readonly string[];
};

export class MercadoPagoProviderError extends PaymentProviderError {
  readonly statusCode: number;
  readonly details: MercadoPagoSafeErrorDetails | undefined;
  readonly requestId: string | undefined;

  constructor(statusCode: number, transient = false, details?: MercadoPagoSafeErrorDetails, requestId?: string) {
    super(formatProviderErrorMessage(statusCode, details, requestId), transient);
    this.name = "MercadoPagoProviderError";
    this.statusCode = statusCode;
    this.details = details;
    this.requestId = requestId;
  }
}

export class MercadoPagoProviderTransientError extends MercadoPagoProviderError {
  constructor(statusCode = 0, details?: MercadoPagoSafeErrorDetails, requestId?: string) {
    super(statusCode, true, details, requestId);
    this.name = "MercadoPagoProviderTransientError";
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

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionResource> {
    const body = await this.get(`/preapproval/${encodeURIComponent(providerSubscriptionId)}`);
    const id = requiredString(body, "id");
    const frequency = isRecord(body.auto_recurring) ? numberField(body.auto_recurring, "frequency") : undefined;
    return {
      id,
      status: requiredString(body, "status"),
      ...optionalField("externalReference", stringField(body, "external_reference")),
      ...optionalField("payerEmail", stringField(body, "payer_email")),
      ...(isRecord(body.auto_recurring) ? {
        autoRecurring: {
          transactionAmountCents: requiredAmountCents(body.auto_recurring, "transaction_amount"),
          currencyId: requiredString(body.auto_recurring, "currency_id"),
          ...(frequency === undefined ? {} : { frequency }),
          ...optionalField("frequencyType", stringField(body.auto_recurring, "frequency_type")),
        },
      } : {}),
    };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPaymentResource> {
    const body = await this.get(`/v1/payments/${encodeURIComponent(providerPaymentId)}`);
    return {
      id: requiredString(body, "id"),
      status: requiredString(body, "status"),
      ...optionalField("statusDetail", stringField(body, "status_detail")),
      ...optionalField("externalReference", stringField(body, "external_reference")),
      transactionAmountCents: requiredAmountCents(body, "transaction_amount"),
      currencyId: requiredString(body, "currency_id"),
    };
  }

  async getAuthorizedPayment(providerAuthorizedPaymentId: string): Promise<ProviderAuthorizedPaymentResource> {
    const body = await this.get(`/authorized_payments/${encodeURIComponent(providerAuthorizedPaymentId)}`);
    const payment = isRecord(body.payment) ? body.payment : undefined;
    return {
      id: requiredString(body, "id"),
      ...optionalField("preapprovalId", stringField(body, "preapproval_id")),
      ...optionalField("status", stringField(body, "status")),
      ...optionalField("statusDetail", stringField(body, "status_detail")),
      ...optionalField("externalReference", stringField(body, "external_reference")),
      ...(numberField(body, "transaction_amount") === undefined ? {} : { transactionAmountCents: requiredAmountCents(body, "transaction_amount") }),
      ...optionalField("currencyId", stringField(body, "currency_id")),
      ...(payment && typeof payment.id === "string" ? { paymentId: payment.id } : {}),
    };
  }

  async createSubscriptionIntent(input: ProviderSubscriptionIntent): Promise<ProviderIntentResult> {
    const response = await this.request("/preapproval", input.idempotencyKey, {
      payer_email: input.payerEmail,
      status: "pending",
      reason: `Atendente 24h - ${input.plan} ${input.billingCycle}`,
      external_reference: input.externalReference,
      auto_recurring: {
        frequency: input.billingCycle === "MONTHLY" ? 1 : 12,
        frequency_type: "months",
        transaction_amount: input.catalog.subscriptionAmountCents / 100,
        currency_id: "BRL",
      },
      back_url: this.options.backUrl,
    }, [input.payerEmail]);
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
    }, [input.payerEmail]);
    return {
      status: providerStatus(response.status),
      ...optionalField("providerPaymentId", stringField(response.body, "id")),
      ...optionalField("checkoutUrl", stringField(response.body, "init_point")),
      ...optionalField("externalReference", stringField(response.body, "external_reference")),
      ...optionalField("providerStatus", stringField(response.body, "status")),
    };
  }

  private async request(path: string, idempotencyKey: string, body: unknown, sensitiveValues: readonly string[] = []): Promise<{ status: number; body: Record<string, unknown> }> {
    let response: MercadoPagoHttpResponse;
    try {
      response = await this.httpClient({
        method: "POST",
        url: `${MERCADO_PAGO_API_BASE_URL}${path}`,
        headers: {
          Authorization: `Bearer ${this.options.accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new PaymentProviderTransientError();
    }
    if (response.status < 200 || response.status >= 300) {
      const requestId = readRequestId(response);
      throw providerError(response.status, response.status >= 400 && response.status < 500
        ? await readSafeErrorDetails(response, [this.options.accessToken, this.options.backUrl, ...sensitiveValues])
        : undefined, requestId);
    }
    const payload = await response.json();
    if (!isRecord(payload)) throw new MercadoPagoProviderError(response.status);
    return { status: response.status, body: payload };
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    let response: MercadoPagoHttpResponse;
    try {
      response = await this.httpClient({
        method: "GET",
        url: `${MERCADO_PAGO_API_BASE_URL}${path}`,
        headers: { Authorization: `Bearer ${this.options.accessToken}`, Accept: "application/json" },
      });
    } catch {
      throw new PaymentProviderTransientError();
    }
    if (response.status < 200 || response.status >= 300) {
      const requestId = readRequestId(response);
      throw providerError(response.status, response.status >= 400 && response.status < 500
        ? await readSafeErrorDetails(response, [this.options.accessToken, this.options.backUrl])
        : undefined, requestId);
    }
    const payload = await response.json();
    if (!isRecord(payload)) throw new MercadoPagoProviderError(response.status);
    return payload;
  }
}

const defaultHttpClient: MercadoPagoHttpClient = async (request) => {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, ...(request.body === undefined ? {} : { body: request.body }) });
  return { status: response.status, headers: response.headers, json: () => response.json() as Promise<unknown> };
};

function providerStatus(httpStatus: number): PaymentTransactionStatus {
  return httpStatus >= 200 && httpStatus < 300 ? PaymentTransactionStatus.PENDING : PaymentTransactionStatus.FAILED;
}

function providerError(statusCode: number, details?: MercadoPagoSafeErrorDetails, requestId?: string): MercadoPagoProviderError {
  return isTransientStatus(statusCode) ? new MercadoPagoProviderTransientError(statusCode, details, requestId) : new MercadoPagoProviderError(statusCode, false, details, requestId);
}

function isTransientStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" && value[key].trim() ? value[key] : undefined;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = stringField(value, key);
  if (field === undefined) throw new MercadoPagoProviderError(200);
  return field;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : undefined;
}

function requiredAmountCents(value: Record<string, unknown>, key: string): number {
  const raw = value[key];
  const text = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new MercadoPagoProviderError(200);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function optionalField(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readSafeErrorDetails(response: MercadoPagoHttpResponse, sensitiveValues: readonly string[]): Promise<MercadoPagoSafeErrorDetails | undefined> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return undefined;
  }
  if (!isRecord(payload)) return undefined;
  const error = safeDiagnosticText(payload.error, sensitiveValues);
  const message = safeDiagnosticText(payload.message, sensitiveValues);
  const causeCodes = Array.isArray(payload.cause)
    ? [...new Set(payload.cause
      .filter(isRecord)
      .map((cause) => safeDiagnosticText(
  typeof cause.code === "number" && Number.isFinite(cause.code)
    ? String(cause.code)
    : cause.code,
  sensitiveValues,
))
      .filter((code): code is string => code !== undefined))].slice(0, 10)
    : [];
  if (error === undefined && message === undefined && causeCodes.length === 0) return undefined;
  return {
    ...(error === undefined ? {} : { error }),
    ...(message === undefined ? {} : { message }),
    causeCodes,
  };
}

function safeDiagnosticText(value: unknown, sensitiveValues: readonly string[]): string | undefined {
  if (typeof value !== "string") return undefined;
  let safe = value.trim();
  if (!safe) return undefined;
  for (const sensitiveValue of sensitiveValues) {
    const normalized = sensitiveValue.trim();
    if (normalized) safe = safe.split(normalized).join("[redacted]");
  }
  safe = safe
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:access[_ -]?token|authorization|webhook[_ -]?secret|card[_ -]?token(?:[_ -]?id)?|payer[_ -]?email)\b\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240)
    .trim();
  return safe || undefined;
}

function readRequestId(response: MercadoPagoHttpResponse): string | undefined {
  const value = response.headers?.get("x-request-id")?.trim();
  return value !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function formatProviderErrorMessage(statusCode: number, details?: MercadoPagoSafeErrorDetails, requestId?: string): string {
  const base = statusCode === 0 ? "Mercado Pago request failed before receiving a response" : `Mercado Pago request failed with HTTP ${statusCode}`;
  if (details === undefined && requestId === undefined) return base;
  const diagnostic = [
    details === undefined || details.error === undefined ? undefined : `error=${details.error}`,
    details === undefined || details.message === undefined ? undefined : `message=${details.message}`,
    details === undefined || details.causeCodes.length === 0 ? undefined : `cause=${details.causeCodes.join(",")}`,
    requestId === undefined ? undefined : `request_id=${requestId}`,
  ].filter((value): value is string => value !== undefined).join("; ");
  return diagnostic ? `${base}: ${diagnostic}` : base;
}
