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
    getMissingQuoteRequiredFields(interpretation()),
    ["brand", "model", "year", "version"],
  );
});

test("returns brand and version when model and year are present", () => {
  assert.deepEqual(
    getMissingQuoteRequiredFields(interpretation({
      extractedVehicleData: { model: "Corolla", year: 2020 },
    })),
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
      },
    })),
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
    })),
    ["brand"],
  );
});

test("ignores model missingData fields outside the deterministic baseline", () => {
  assert.deepEqual(
    getMissingQuoteRequiredFields(interpretation({
      extractedVehicleData: {
        brand: "Toyota",
        model: "Corolla",
        year: 2020,
        version: "XEi",
      },
      missingData: ["licensePlate", "mileage", "name", "primaryPhone", "email"],
    })),
    [],
  );
});
