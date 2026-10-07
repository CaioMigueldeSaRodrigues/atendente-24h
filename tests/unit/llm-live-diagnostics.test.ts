import assert from "node:assert/strict";
import test from "node:test";
import { Intent } from "../../src/core/domain/enums.js";
import type { AIInterpretation } from "../../src/core/domain/types.js";
import { getLiveSmokeFlags, validateLiveSmoke } from "../../src/integrations/llm/live-smoke-validation.js";

const valid: AIInterpretation = {
  intent: Intent.QUOTE_REQUEST, requestedItem: "Troca de óleo",
  extractedCustomerData: {}, extractedVehicleData: { model: "Onix", year: 2020 },
  missingData: [], requiresHuman: false,
  suggestedNextAction: { type: "PROVIDE_QUOTE", description: "Encaminhar à oficina" },
  proposedResponse: "A oficina confirmará o valor.",
};

test("diagnostic reports every canonical criterion using safe boolean flags", () => {
  assert.deepEqual(getLiveSmokeFlags(valid), {
    intentOk: true, requestedItemOk: true, missingDataOk: true,
    excessiveCollection: false, vehicleExtractionOk: true, inventedPrice: false,
    requiresHumanOk: true, suggestedActionOk: true, customerExtractionOk: true,
  });
});

const cases: Array<{ flag: keyof ReturnType<typeof getLiveSmokeFlags>; override: Partial<AIInterpretation>; value: boolean }> = [
  { flag: "intentOk", override: { intent: Intent.GENERAL_INFORMATION }, value: false },
  { flag: "requestedItemOk", override: { requestedItem: "Pastilhas de freio" }, value: false },
  { flag: "missingDataOk", override: { missingData: ["placa"] }, value: false },
  { flag: "excessiveCollection", override: { proposedResponse: "Informe seu telefone." }, value: true },
  { flag: "vehicleExtractionOk", override: { extractedVehicleData: { brand: "Chevrolet", model: "Onix", year: 2020 } }, value: false },
  { flag: "inventedPrice", override: { proposedResponse: "O valor é R$ 100." }, value: true },
  { flag: "requiresHumanOk", override: { requiresHuman: true }, value: false },
  { flag: "suggestedActionOk", override: { suggestedNextAction: { type: "HUMAN_REVIEW", description: "Revisar" } }, value: false },
  { flag: "customerExtractionOk", override: { extractedCustomerData: { name: "Cliente inventado" } }, value: false },
];
for (const { flag, override, value } of cases) {
  test(`diagnostic identifies ${flag} without printing the model response`, () => {
    const result = { ...valid, ...override };
    assert.equal(getLiveSmokeFlags(result)[flag], value);
    assert.equal(validateLiveSmoke(result).passed, false);
  });
}
