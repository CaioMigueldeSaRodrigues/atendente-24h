import assert from "node:assert/strict";
import test from "node:test";
import { Intent } from "../../src/core/domain/enums.js";
import { z } from "zod";
import { modelAIInterpretationSchema, parseAIInterpretation } from "../../src/core/ai-interpretation-schema.js";

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

test("integer year and mileage inside the range survive, the rest becomes absent without failing", () => {
  const withVehicle = (year: number | null, mileage: number | null) => {
    const input = validInput();
    return parseAIInterpretation({ ...input, extractedVehicleData: { ...input.extractedVehicleData, year, mileage } });
  };

  assert.equal(withVehicle(2020, 120000).extractedVehicleData.mileage, 120000);
  assert.equal(withVehicle(2020, 120000).extractedVehicleData.year, 2020);
  for (const [year, mileage] of [[2020.5, 1.5], [1800, -1], [3000, 1e9]] as const) {
    const parsed = withVehicle(year, mileage);
    assert.equal(Object.hasOwn(parsed.extractedVehicleData, "year"), false);
    assert.equal(Object.hasOwn(parsed.extractedVehicleData, "mileage"), false);
    assert.equal(parsed.intent, Intent.QUOTE_REQUEST);
  }
});

test("the schema sent to the model has no numeric range at all, while the parse still enforces the confidence range", () => {
  const schema = JSON.stringify(z.toJSONSchema(modelAIInterpretationSchema));
  assert.equal(/minimum|maximum/.test(schema), false);
  assert.equal(parseAIInterpretation({ ...validInput(), confidence: 0 }).confidence, 0);
  assert.equal(parseAIInterpretation({ ...validInput(), confidence: 1 }).confidence, 1);
  assert.throws(() => parseAIInterpretation({ ...validInput(), confidence: 1.5 }));
  assert.throws(() => parseAIInterpretation({ ...validInput(), confidence: Number.NaN }));
});

test("the schema sent to the model has no numeric range on the vehicle", () => {
  const schema = JSON.stringify(z.toJSONSchema(modelAIInterpretationSchema));
  const vehicle = schema.slice(schema.indexOf("extractedVehicleData"), schema.indexOf("symptomDescription"));
  assert.ok(vehicle.includes("mileage"));
  assert.equal(/minimum|maximum/.test(vehicle), false);
});
