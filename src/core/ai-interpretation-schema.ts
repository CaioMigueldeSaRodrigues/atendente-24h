import { z } from "zod";
import { HandoffReason, Intent } from "./domain/enums.js";
import type { AIInterpretation } from "./domain/types.js";

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
    confidence: z.number().min(0).max(1).nullable(),
  })
  .strict();

export function parseAIInterpretation(input: unknown): AIInterpretation {
  const parsed = modelAIInterpretationSchema.parse(input);

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
      ...(parsed.extractedVehicleData.year !== null
        ? { year: parsed.extractedVehicleData.year }
        : {}),
      ...(parsed.extractedVehicleData.version !== null
        ? { version: parsed.extractedVehicleData.version }
        : {}),
      ...(parsed.extractedVehicleData.licensePlate !== null
        ? { licensePlate: parsed.extractedVehicleData.licensePlate }
        : {}),
      ...(parsed.extractedVehicleData.mileage !== null
        ? { mileage: parsed.extractedVehicleData.mileage }
        : {}),
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
