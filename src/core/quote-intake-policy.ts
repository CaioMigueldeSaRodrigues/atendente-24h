import type { AIInterpretation } from "./domain/types.js";

// Baseline do MVP; futuramente poderá ser configurado por business/catalog item.
export const DEFAULT_QUOTE_REQUIRED_FIELDS = [
  "brand",
  "model",
  "year",
  "version",
] as const;

export function getMissingQuoteRequiredFields(
  interpretation: AIInterpretation,
): readonly string[] {
  const vehicleData = interpretation.extractedVehicleData;

  return DEFAULT_QUOTE_REQUIRED_FIELDS.filter((field) => {
    const value = vehicleData[field];
    return typeof value === "string"
      ? value.trim().length === 0
      : value === undefined;
  });
}
