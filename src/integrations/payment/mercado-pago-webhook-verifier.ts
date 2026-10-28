import { createHmac, timingSafeEqual } from "node:crypto";

export type MercadoPagoWebhookVerificationInput = {
  signature: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
  secret: string;
};

export class MercadoPagoWebhookVerifier {
  constructor(private readonly secret: string) {
    if (!secret.trim()) throw new Error("Mercado Pago webhook secret is required");
  }

  verify(input: Omit<MercadoPagoWebhookVerificationInput, "secret">): boolean {
    const signature = input.signature?.trim();
    if (!signature) return false;
    const values = parseSignature(signature);
    if (values.ts === undefined || values.v1 === undefined) return false;

    const manifestParts: string[] = [];
    if (input.dataId !== undefined && input.dataId.trim() !== "") manifestParts.push(`id:${input.dataId.trim()}`);
    if (input.requestId !== undefined && input.requestId.trim() !== "") manifestParts.push(`request-id:${input.requestId.trim()}`);
    manifestParts.push(`ts:${values.ts}`);
    const manifest = `${manifestParts.join(";")};`;
    const expected = createHmac("sha256", this.secret).update(manifest).digest();
    const received = decodeHex(values.v1);
    return received !== null && received.length === expected.length && timingSafeEqual(expected, received);
  }
}

function parseSignature(signature: string): { ts?: string; v1?: string } {
  const result: { ts?: string; v1?: string } = {};
  // The official examples use commas, while semicolons are also accepted by
  // Mercado Pago SDKs. Accept both separators without relaxing the HMAC check.
  for (const component of signature.split(/[;,]/)) {
    const separator = component.indexOf("=");
    if (separator < 1) continue;
    const key = component.slice(0, separator).trim();
    const value = component.slice(separator + 1).trim();
    if (key === "ts" && value) result.ts = value;
    if (key === "v1" && value) result.v1 = value;
  }
  return result;
}

function decodeHex(value: string): Buffer | null {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) return null;
  return Buffer.from(value, "hex");
}
