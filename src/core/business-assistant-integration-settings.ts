export type BusinessAssistantIntegrationSettings = {
  businessId: string;
  inventoryForAssistantEnabled: boolean;
  productPricingForAssistantEnabled: boolean;
  laborPricingForAssistantEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BusinessAssistantIntegrationSettingsRepository = {
  findByBusinessId(businessId: string): Promise<BusinessAssistantIntegrationSettings | null>;
  save(settings: BusinessAssistantIntegrationSettings): Promise<void>;
};

export const DEFAULT_BUSINESS_ASSISTANT_INTEGRATION_SETTINGS = {
  inventoryForAssistantEnabled: false,
  productPricingForAssistantEnabled: false,
  laborPricingForAssistantEnabled: false,
} as const;
