import { AdminPlan } from "./admin-plan-entitlement.js";
import type { BusinessPlanAssignmentRepository } from "./business-plan.js";
import { DEFAULT_BUSINESS_ASSISTANT_INTEGRATION_SETTINGS, type BusinessAssistantIntegrationSettings, type BusinessAssistantIntegrationSettingsRepository } from "./business-assistant-integration-settings.js";

export type IntegrationProviderAvailability = { inventory: boolean; productPricing: boolean; laborPricing: boolean };
export type IntegrationProviderStatus = "AVAILABLE" | "PROVIDER_UNAVAILABLE";
export type BusinessCapabilities = {
  businessId: string;
  plan: AdminPlan | null;
  entitlements: { inventoryIntegration: boolean; productPricingIntegration: boolean; laborPricingIntegration: boolean };
  settings: Omit<BusinessAssistantIntegrationSettings, "businessId" | "createdAt" | "updatedAt">;
  providerAvailability: { inventory: IntegrationProviderStatus; productPricing: IntegrationProviderStatus; laborPricing: IntegrationProviderStatus };
  capabilities: { canUseInventoryInAssistant: boolean; canUseProductPricingInAssistant: boolean; canUseLaborPricingInAssistant: boolean; canBuildIntegratedQuote: boolean };
  canBuildIntegratedQuote: boolean;
};
export interface BusinessCapabilityPolicy { getCapabilities(businessId: string, providerAvailability?: IntegrationProviderAvailability): Promise<BusinessCapabilities>; }

const DEFAULT_PROVIDER_AVAILABILITY: IntegrationProviderAvailability = { inventory: false, productPricing: false, laborPricing: false };

export class AssignmentBusinessCapabilityPolicy implements BusinessCapabilityPolicy {
  constructor(private readonly assignments: BusinessPlanAssignmentRepository, private readonly settingsRepository: BusinessAssistantIntegrationSettingsRepository, private readonly defaultProviderAvailability: IntegrationProviderAvailability = DEFAULT_PROVIDER_AVAILABILITY) {}
  async getCapabilities(businessId: string, providerAvailability = this.defaultProviderAvailability): Promise<BusinessCapabilities> {
    const [assignment, storedSettings] = await Promise.all([this.assignments.findCurrent(businessId), this.settingsRepository.findByBusinessId(businessId)]);
    return makeCapabilities(businessId, assignment?.plan ?? null, storedSettings, providerAvailability);
  }
}

export class StaticBusinessCapabilityPolicy implements BusinessCapabilityPolicy {
  constructor(private readonly plan: AdminPlan | null, private readonly configuredSettings: Partial<BusinessCapabilities["settings"]> = {}, private readonly defaultProviderAvailability: IntegrationProviderAvailability = DEFAULT_PROVIDER_AVAILABILITY) {}
  async getCapabilities(businessId: string, providerAvailability = this.defaultProviderAvailability): Promise<BusinessCapabilities> {
    const settings = { ...DEFAULT_BUSINESS_ASSISTANT_INTEGRATION_SETTINGS, ...this.configuredSettings };
    return makeCapabilities(businessId, this.plan, { businessId, ...settings, createdAt: "", updatedAt: "" }, providerAvailability);
  }
}

function makeCapabilities(businessId: string, plan: AdminPlan | null, storedSettings: BusinessAssistantIntegrationSettings | null, providerAvailability: IntegrationProviderAvailability): BusinessCapabilities {
  const settings = {
    inventoryForAssistantEnabled: storedSettings?.inventoryForAssistantEnabled ?? DEFAULT_BUSINESS_ASSISTANT_INTEGRATION_SETTINGS.inventoryForAssistantEnabled,
    productPricingForAssistantEnabled: storedSettings?.productPricingForAssistantEnabled ?? DEFAULT_BUSINESS_ASSISTANT_INTEGRATION_SETTINGS.productPricingForAssistantEnabled,
    laborPricingForAssistantEnabled: storedSettings?.laborPricingForAssistantEnabled ?? DEFAULT_BUSINESS_ASSISTANT_INTEGRATION_SETTINGS.laborPricingForAssistantEnabled,
  };
  const entitled = plan === AdminPlan.INTERMEDIATE || plan === AdminPlan.ADVANCED;
  const entitlements = { inventoryIntegration: entitled, productPricingIntegration: entitled, laborPricingIntegration: entitled };
  const capabilities = {
    canUseInventoryInAssistant: entitlements.inventoryIntegration && settings.inventoryForAssistantEnabled && providerAvailability.inventory,
    canUseProductPricingInAssistant: entitlements.productPricingIntegration && settings.productPricingForAssistantEnabled && providerAvailability.productPricing,
    canUseLaborPricingInAssistant: entitlements.laborPricingIntegration && settings.laborPricingForAssistantEnabled && providerAvailability.laborPricing,
  };
  const canBuildIntegratedQuote = capabilities.canUseInventoryInAssistant && capabilities.canUseProductPricingInAssistant && capabilities.canUseLaborPricingInAssistant;
  return { businessId, plan, entitlements, settings, providerAvailability: { inventory: providerAvailability.inventory ? "AVAILABLE" : "PROVIDER_UNAVAILABLE", productPricing: providerAvailability.productPricing ? "AVAILABLE" : "PROVIDER_UNAVAILABLE", laborPricing: providerAvailability.laborPricing ? "AVAILABLE" : "PROVIDER_UNAVAILABLE" }, capabilities: { ...capabilities, canBuildIntegratedQuote }, canBuildIntegratedQuote };
}
