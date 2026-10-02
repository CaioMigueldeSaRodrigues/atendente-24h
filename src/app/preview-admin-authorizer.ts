import type { AdminBusinessScopeAuthorizer } from "../core/admin-read-model.js";

/** Explicit local-only scope for the administrative preview. */
export class PreviewAdminBusinessScopeAuthorizer implements AdminBusinessScopeAuthorizer {
  constructor(private readonly allowedBusinessIds: ReadonlySet<string>) {}

  async isAuthorized({ businessId }: { businessId: string }): Promise<boolean> {
    return this.allowedBusinessIds.has(businessId);
  }
}
