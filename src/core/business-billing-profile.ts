export type BusinessBillingProfile = {
  businessId: string;
  payerEmail: string;
  createdAt: string;
  updatedAt: string;
};

export type BusinessBillingProfileRepository = {
  findByBusinessId(businessId: string): Promise<BusinessBillingProfile | null>;
  save(profile: BusinessBillingProfile): Promise<void>;
};

export class BusinessBillingProfileService {
  constructor(private readonly repository: BusinessBillingProfileRepository) {}

  async resolvePayerEmail(businessId: string): Promise<string | null> {
    const profile = await this.repository.findByBusinessId(businessId);
    if (profile === null) return null;
    return normalizePayerEmail(profile.payerEmail);
  }

  async save(input: { businessId: string; payerEmail: string; now: string }): Promise<BusinessBillingProfile> {
    if (!input.businessId.trim()) throw new Error("businessId is required");
    const payerEmail = normalizePayerEmail(input.payerEmail);
    const current = await this.repository.findByBusinessId(input.businessId);
    const profile: BusinessBillingProfile = {
      businessId: input.businessId,
      payerEmail,
      createdAt: current?.createdAt ?? input.now,
      updatedAt: input.now,
    };
    await this.repository.save(profile);
    return profile;
  }
}

export function normalizePayerEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("payerEmail is invalid");
  return normalized;
}
