import type { SuperAdminAuthorizer } from "../core/platform-admin-read-model.js";

/** Explicitly enabled only by the local preview entrypoint. */
export class PreviewSuperAdminAuthorizer implements SuperAdminAuthorizer {
  constructor(private readonly enabled = true) {}

  async isAuthorized(): Promise<boolean> {
    return this.enabled;
  }
}
