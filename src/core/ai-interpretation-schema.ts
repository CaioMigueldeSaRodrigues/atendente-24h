import { z } from "zod";
import { HandoffReason, Intent } from "./domain/enums.js";
import type { AIInterpretation } from "./domain/types.js";

const MIN_VEHICLE_YEAR = 1900;
const MAX_VEHICLE_YEAR = 2100;
const MAX_VEHICLE_MILEAGE = 3_000_000;

export const modelAIInterpretationSchema = z
  .object({
    intent: z.nativeEnum(Intent),
    extractedCustomerData: z
      .object({
        name: z.string().nullable(),
        primaryPhone: z.string().nullable(),
        email: z.string().nullable(),
      })
      .strict(),
    extractedVehicleData: z
      .object({
        brand: z.string().nullable(),
        model: z.string().nullable(),
        year: z.number().nullable(),
        version: z.string().nullable(),
        licensePlate: z.string().nullable(),
        mileage: z.number().nullable(),
      })
      .strict(),
    symptomDescription: z.string().nullable(),
    requestedItem: z.string().nullable(),
    missingData: z.array(z.string()),
    suggestedNextAction: z
      .object({
        type: z.enum([
          "PROVIDE_QUOTE",
          "CALL_CUSTOMER",
          "CONFIRM_AVAILABILITY",
          "SCHEDULE_EVALUATION",
          "REQUEST_INFORMATION",
          "HUMAN_REVIEW",
          "TECHNICAL_REVIEW",
          "NONE",
        ]),
        description: z.string(),
        dueAt: z.string().nullable(),
        assignedTo: z.string().nullable(),
      })
      .strict(),
    requiresHuman: z.boolean(),
    handoffReason: z.nativeEnum(HandoffReason).nullable(),
    proposedResponse: z.string().min(1),
    confidence: z.number().nullable(),
  })
  .strict();

// The range stays out of the schema sent to the model: providers differ on which JSON Schema keywords they accept.
function checkConfidence(value: number | null): void {
  if (value !== null && !(value >= 0 && value <= 1)) throw new Error("AI confidence is out of range");
}

function integerInRange(value: number | null, min: number, max: number): number | null {
  return value !== null && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function parseAIInterpretation(input: unknown): AIInterpretation {
  const parsed = modelAIInterpretationSchema.parse(input);
  checkConfidence(parsed.confidence);
  const year = integerInRange(parsed.extractedVehicleData.year, MIN_VEHICLE_YEAR, MAX_VEHICLE_YEAR);
  const mileage = integerInRange(parsed.extractedVehicleData.mileage, 0, MAX_VEHICLE_MILEAGE);

  return {
    intent: parsed.intent,
    extractedCustomerData: {
      ...(parsed.extractedCustomerData.name !== null
        ? { name: parsed.extractedCustomerData.name }
        : {}),
      ...(parsed.extractedCustomerData.primaryPhone !== null
        ? { primaryPhone: parsed.extractedCustomerData.primaryPhone }
        : {}),
      ...(parsed.extractedCustomerData.email !== null
        ? { email: parsed.extractedCustomerData.email }
        : {}),
    },
    extractedVehicleData: {
      ...(parsed.extractedVehicleData.brand !== null
        ? { brand: parsed.extractedVehicleData.brand }
        : {}),
      ...(parsed.extractedVehicleData.model !== null
        ? { model: parsed.extractedVehicleData.model }
        : {}),
      ...(year !== null ? { year } : {}),
      ...(parsed.extractedVehicleData.version !== null
        ? { version: parsed.extractedVehicleData.version }
        : {}),
      ...(parsed.extractedVehicleData.licensePlate !== null
        ? { licensePlate: parsed.extractedVehicleData.licensePlate }
        : {}),
      ...(mileage !== null ? { mileage } : {}),
    },
    ...(parsed.symptomDescription !== null
      ? { symptomDescription: parsed.symptomDescription }
      : {}),
    ...(parsed.requestedItem !== null
      ? { requestedItem: parsed.requestedItem }
      : {}),
    missingData: parsed.missingData,
    suggestedNextAction: {
      type: parsed.suggestedNextAction.type,
      description: parsed.suggestedNextAction.description,
      ...(parsed.suggestedNextAction.dueAt !== null
        ? { dueAt: parsed.suggestedNextAction.dueAt }
        : {}),
      ...(parsed.suggestedNextAction.assignedTo !== null
        ? { assignedTo: parsed.suggestedNextAction.assignedTo }
        : {}),
    },
    requiresHuman: parsed.requiresHuman,
    ...(parsed.handoffReason !== null
      ? { handoffReason: parsed.handoffReason }
      : {}),
    proposedResponse: parsed.proposedResponse,
    ...(parsed.confidence !== null ? { confidence: parsed.confidence } : {}),
  };
}
