export interface BusinessOperatorAuthorizer {
  isAuthorized(input: { businessId: string; credential?: string }): Promise<boolean>;
}
