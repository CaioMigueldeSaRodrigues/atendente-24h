import { createHash, timingSafeEqual } from "node:crypto";
import type { BusinessOperatorAuthorizer } from "../../core/business-operator-authorizer.js";

export class BasicBusinessOperatorAuthorizer implements BusinessOperatorAuthorizer {
  constructor(
    private readonly businessId: string,
    private readonly username: string,
    private readonly password: string,
  ) {
    if (username.length === 0 || username.includes(":") || password.length < 16) {
      throw new Error("Operator credentials are invalid");
    }
  }

  async isAuthorized(input: { businessId: string; credential?: string }): Promise<boolean> {
    if (input.businessId !== this.businessId || input.credential === undefined) return false;
    const credentials = readBasicCredentials(input.credential);
    return credentials !== null
      && safeEqual(credentials.username, this.username)
      && safeEqual(credentials.password, this.password);
  }
}

function readBasicCredentials(authorization: string): { username: string; password: string } | null {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (match === null) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

function safeEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}
