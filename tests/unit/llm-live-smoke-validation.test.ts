import assert from "node:assert/strict";
import test from "node:test";
import { Intent } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { validateLiveSmoke } from "../../src/integrations/llm/live-smoke-validation.js";

const valid: AIInterpretation = {
  intent: Intent.QUOTE_REQUEST, extractedCustomerData: {}, extractedVehicleData: { model: "Onix", year: 2020 },
  requestedItem: "Troca de óleo", missingData: [], requiresHuman: false,
  suggestedNextAction: { type: "PROVIDE_QUOTE", description: "Encaminhar à oficina" },
  proposedResponse: "A oficina preparará o orçamento para seu Onix 2020 e confirmará o valor.",
};

test("live smoke accepts canonical structured interpretation with Portuguese accents", () => {
  assert.deepEqual(validateLiveSmoke(valid), { passed: true, excessiveCollection: false, failure: null });
  assert.equal(validateLiveSmoke({ ...valid, extractedVehicleData: { model: "ONIX", year: 2020 } }).passed, true);
});

test("live smoke rejects overcollection in fields, actions or the proposed reply", () => {
  for (const override of [
    { missingData: ["placa"] },
    { suggestedNextAction: { type: "REQUEST_INFORMATION" as const, description: "Complete os dados" } },
    { proposedResponse: "Informe telefone, quilometragem e versão." },
  ]) {
    assert.deepEqual(validateLiveSmoke({ ...valid, ...override }), { passed: false, excessiveCollection: true, failure: "EXCESSIVE_COLLECTION" });
  }
});

test("live smoke rejects quoted prices, wrong intent, missing item and inferred brand", () => {
  for (const override of [
    { proposedResponse: "Custa R$ 100." },
    { proposedResponse: "Custa cem reais." },
    { proposedResponse: "Custa 100." },
    { intent: Intent.GENERAL_INFORMATION },
    { requestedItem: " " },
    { extractedVehicleData: { model: "Onix", year: 2020, brand: "Chevrolet" } },
  ]) assert.equal(validateLiveSmoke({ ...valid, ...override }).passed, false);
});
