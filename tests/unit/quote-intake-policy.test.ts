import assert from "node:assert/strict";
import test from "node:test";
import { Intent } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import {
  DEFAULT_QUOTE_REQUIRED_FIELDS,
  getMissingQuoteRequiredFields,
} from "../../src/core/quote-intake-policy.js";

const interpretation = (
  overrides: Partial<AIInterpretation> = {},
): AIInterpretation => ({
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: {},
  extractedVehicleData: {},
  missingData: [],
  suggestedNextAction: { type: "NONE", description: "No action" },
  requiresHuman: false,
  proposedResponse: "Response",
  ...overrides,
});

test("returns all absent required vehicle fields in baseline order", () => {
  assert.deepEqual(DEFAULT_QUOTE_REQUIRED_FIELDS, ["brand", "model", "year", "version"]);
  assert.deepEqual(
    getMissingQuoteRequiredFields(interpretation().extractedVehicleData),
    ["brand", "model", "year", "version"],
  );
});

test("returns brand and version when model and year are present", () => {
  assert.deepEqual(
    getMissingQuoteRequiredFields(interpretation({
      extractedVehicleData: { model: "Corolla", year: 2020 },
    }).extractedVehicleData),
    ["brand", "version"],
  );
});

test("returns no missing fields when all baseline data is present", () => {
  assert.deepEqual(
    getMissingQuoteRequiredFields(interpretation({
      extractedVehicleData: {
        brand: "Toyota",
        model: "Corolla",
        year: 2020,
        version: "XEi",
        licensePlate: "ABC1D23",
        mileage: 42000,
      },
      missingData: ["licensePlate", "mileage", "name", "primaryPhone", "email"],
    }).extractedVehicleData),
    [],
  );
});

test("treats a whitespace-only string as missing", () => {
  assert.deepEqual(
    getMissingQuoteRequiredFields(interpretation({
      extractedVehicleData: {
        brand: "   ",
        model: "Corolla",
        year: 2020,
        version: "XEi",
      },
    }).extractedVehicleData),
    ["brand"],
  );
});
