export interface BusinessOperatorAuthorizer {
  isAuthorized(input: { businessId: string }): Promise<boolean>;
}

export class StaticBusinessOperatorAuthorizer implements BusinessOperatorAuthorizer {
  constructor(private readonly businessId: string) {}

  async isAuthorized(input: { businessId: string }): Promise<boolean> {
    return input.businessId === this.businessId;
  }
}
