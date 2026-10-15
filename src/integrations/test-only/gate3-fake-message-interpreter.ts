import { Intent } from "../../core/domain/enums.js";
import type { AIInterpretation } from "../../core/domain/types.js";
import type { MessageInterpreter, MessageInterpreterInput } from "../../core/message-interpreter.js";

/**
 * Deterministic interpreter for the manual Gate 3 external E2E run.
 * It deliberately contains no provider credentials, contact data or pricing.
 */
export class Gate3FakeMessageInterpreter implements MessageInterpreter {
  async interpret(_input: MessageInterpreterInput): Promise<AIInterpretation> {
    return {
      intent: Intent.QUOTE_REQUEST,
      extractedCustomerData: {},
      extractedVehicleData: {},
      requestedItem: "Troca de óleo",
      missingData: [],
      suggestedNextAction: {
        type: "PROVIDE_QUOTE",
        description: "Aguardar autorização manual do orçamento no operador",
      },
      requiresHuman: false,
      proposedResponse: "Recebi seu pedido de orçamento para troca de óleo. A oficina vai confirmar o valor.",
      confidence: 1,
    };
  }
}
