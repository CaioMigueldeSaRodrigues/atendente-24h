import { Intent } from "../../core/domain/enums.js";
import type { AIInterpretation } from "../../core/domain/types.js";

export const LIVE_SMOKE_INPUT = "Olá. Quero orçamento para troca de óleo do meu Onix 2020.";

// Verificações conservadoras para esta entrada sintética fixa. Não editam texto
// nem substituem a política determinística usada pelo fluxo de produção.
export function getLiveSmokeFlags(result: AIInterpretation) {
  const text = `${result.proposedResponse} ${result.suggestedNextAction.description}`;
  const excessiveCollection = result.missingData.length > 0 ||
    result.suggestedNextAction.type === "REQUEST_INFORMATION" ||
    /placa|telefone|e-?mail|quilometragem|\bkm\b|vers[aã]o|\bcpf\b|chassi|endere[cç]o|cadastro/i.test(text);
  const inventedPrice = /R\$|\bBRL\b|reais|\breal\b|gr[aá]tis|gratuit[oa]|\d/i.test(text.replaceAll("2020", ""));
  const inventedVehicleExtraction = Object.keys(result.extractedVehicleData).some((field) => field !== "model" && field !== "year") ||
    (result.extractedVehicleData.model !== undefined && result.extractedVehicleData.model.trim().toLowerCase() !== "onix") ||
    (result.extractedVehicleData.year !== undefined && result.extractedVehicleData.year !== 2020);
  return {
    intentOk: result.intent === Intent.QUOTE_REQUEST,
    requestedItemOk: Boolean(result.requestedItem?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("troca de oleo")),
    missingDataOk: result.missingData.length === 0,
    excessiveCollection,
    vehicleExtractionOk: !inventedVehicleExtraction,
    inventedPrice,
    requiresHumanOk: result.requiresHuman === false,
    suggestedActionOk: result.suggestedNextAction.type === "PROVIDE_QUOTE",
    // Preserva também o critério anterior sobre dados de cliente não declarados.
    customerExtractionOk: Object.keys(result.extractedCustomerData).length === 0,
  };
}

export function validateLiveSmoke(result: AIInterpretation) {
  const flags = getLiveSmokeFlags(result);
  const failure = !flags.intentOk ? "UNEXPECTED_INTENT"
    : !flags.requestedItemOk ? "MISSING_COMMERCIAL_OBJECT"
    : flags.excessiveCollection ? "EXCESSIVE_COLLECTION"
    : flags.inventedPrice ? "PRICE_INDICATOR"
    : !flags.vehicleExtractionOk || !flags.customerExtractionOk ? "UNDECLARED_EXTRACTION"
    : !flags.requiresHumanOk ? "UNEXPECTED_HUMAN_REQUIREMENT"
    : !flags.suggestedActionOk ? "UNEXPECTED_ACTION"
    : null;
  return {
    excessiveCollection: flags.excessiveCollection,
    passed: failure === null,
    failure,
  };
}
