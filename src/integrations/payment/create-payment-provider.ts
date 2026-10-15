import type { PaymentEnvironment } from "../../config/payment-environment.js";
import type { PaymentProvider } from "../../core/payment-provider.js";
import { MercadoPagoPaymentProvider } from "./mercado-pago-payment-provider.js";
import { MockPaymentProvider } from "./mock-payment-provider.js";

export function createPaymentProvider(environment: PaymentEnvironment): PaymentProvider {
  if (environment.mode === "mock") return new MockPaymentProvider();
  if (!environment.mercadoPagoAccessToken || !environment.mercadoPagoBackUrl) {
    throw new Error("Mercado Pago configuration is incomplete");
  }
  return new MercadoPagoPaymentProvider({
    accessToken: environment.mercadoPagoAccessToken,
    backUrl: environment.mercadoPagoBackUrl,
  });
}
