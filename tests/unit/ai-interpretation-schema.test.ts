import assert from "node:assert/strict";
import test from "node:test";
import { Intent } from "../../src/core/domain/enums.js";
import { parseAIInterpretation } from "../../src/core/ai-interpretation-schema.js";

const validInput = () => ({
  intent: Intent.QUOTE_REQUEST,
  extractedCustomerData: {
    name: null,
    primaryPhone: null,
    email: null,
  },
  extractedVehicleData: {
    brand: null,
    model: null,
    year: null,
    version: null,
    licensePlate: null,
    mileage: null,
  },
  symptomDescription: null,
  requestedItem: null,
  missingData: ["vehicle model"],
  suggestedNextAction: {
    type: "PROVIDE_QUOTE",
    description: "Provide an authorized quote",
    dueAt: null,
    assignedTo: null,
  },
  requiresHuman: false,
  handoffReason: null,
  proposedResponse: "I can register your quote request.",
  confidence: null,
});

test("accepts a complete Structured Output and maps nullable values to absence", () => {
  const parsed = parseAIInterpretation(validInput());

  assert.equal(parsed.intent, Intent.QUOTE_REQUEST);
  assert.deepEqual(parsed.missingData, ["vehicle model"]);
  assert.equal(parsed.proposedResponse, "I can register your quote request.");
  assert.equal(Object.hasOwn(parsed, "requestedItem"), false);
  assert.equal(Object.hasOwn(parsed, "symptomDescription"), false);
  assert.equal(Object.hasOwn(parsed, "handoffReason"), false);
  assert.equal(Object.hasOwn(parsed, "confidence"), false);
  assert.deepEqual(parsed.extractedCustomerData, {});
  assert.deepEqual(parsed.extractedVehicleData, {});
  assert.equal(Object.hasOwn(parsed.suggestedNextAction, "dueAt"), false);
  assert.equal(Object.hasOwn(parsed.suggestedNextAction, "assignedTo"), false);
});

test("rejects an invalid Intent", () => {
  const input = { ...validInput(), intent: "NOT_AN_INTENT" };

  assert.throws(() => parseAIInterpretation(input));
});

test("rejects a non-boolean requiresHuman", () => {
  const input = { ...validInput(), requiresHuman: "false" };

  assert.throws(() => parseAIInterpretation(input));
});

test("rejects confidence below zero", () => {
  const input = { ...validInput(), confidence: -0.01 };

  assert.throws(() => parseAIInterpretation(input));
});

test("rejects confidence above one", () => {
  const input = { ...validInput(), confidence: 1.01 };

  assert.throws(() => parseAIInterpretation(input));
});

test("rejects an empty proposedResponse", () => {
  const input = { ...validInput(), proposedResponse: "" };

  assert.throws(() => parseAIInterpretation(input));
});

test("rejects an invalid suggestedNextAction type", () => {
  const input = {
    ...validInput(),
    suggestedNextAction: {
      type: "MAKE_PURCHASE",
      description: "Unexpected",
      dueAt: null,
      assignedTo: null,
    },
  };

  assert.throws(() => parseAIInterpretation(input));
});

test("rejects an invalid handoffReason", () => {
  const input = { ...validInput(), handoffReason: "UNKNOWN_REASON" };

  assert.throws(() => parseAIInterpretation(input));
});

test("rejects an unexpected top-level field", () => {
  const input = { ...validInput(), diagnosis: "brake failure" };

  assert.throws(() => parseAIInterpretation(input));
});

test("rejects an omitted nullable top-level field", () => {
  const { requestedItem: _omitted, ...input } = validInput();

  assert.throws(() => parseAIInterpretation(input));
});

test("accepts null values for optional customer and vehicle data", () => {
  const parsed = parseAIInterpretation(validInput());

  assert.deepEqual(parsed.extractedCustomerData, {});
  assert.deepEqual(parsed.extractedVehicleData, {});
});

test("preserves valid customer and vehicle data", () => {
  const input = {
    ...validInput(),
    extractedCustomerData: {
      name: "Ana",
      primaryPhone: "+5511999999999",
      email: "ana@example.com",
    },
    extractedVehicleData: {
      brand: "Toyota",
      model: "Corolla",
      year: 2022,
      version: "XEi",
      licensePlate: "ABC1D23",
      mileage: 42000,
    },
  };

  const parsed = parseAIInterpretation(input);

  assert.deepEqual(parsed.extractedCustomerData, input.extractedCustomerData);
  assert.deepEqual(parsed.extractedVehicleData, input.extractedVehicleData);
});
