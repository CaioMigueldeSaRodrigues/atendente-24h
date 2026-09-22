import type { HandoffReason, Intent } from "./enums.js";

export type Money = {
  amountCents: number;
  currency: "BRL";
};

export type NextAction = {
  type:
    | "PROVIDE_QUOTE"
    | "CALL_CUSTOMER"
    | "CONFIRM_AVAILABILITY"
    | "SCHEDULE_EVALUATION"
    | "REQUEST_INFORMATION"
    | "HUMAN_REVIEW"
    | "TECHNICAL_REVIEW"
    | "NONE";
  description: string;
  dueAt?: string;
  assignedTo?: string;
};

export type AIInterpretation = {
  intent: Intent;
  extractedCustomerData: {
    name?: string;
    primaryPhone?: string;
    email?: string;
  };
  extractedVehicleData: {
    brand?: string;
    model?: string;
    year?: number;
    version?: string;
    licensePlate?: string;
    mileage?: number;
  };
  symptomDescription?: string;
  requestedItem?: string;
  missingData: string[];
  suggestedNextAction: NextAction;
  requiresHuman: boolean;
  handoffReason?: HandoffReason;
  proposedResponse: string;
  confidence?: number;
};
