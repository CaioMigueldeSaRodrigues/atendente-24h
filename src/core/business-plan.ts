import type { AdminPlan } from "./admin-plan-entitlement.js";

export type BusinessPlanAssignmentStatus = "ACTIVE" | "ENDED";

export type BusinessPlanAssignment = {
  id: string;
  businessId: string;
  plan: AdminPlan;
  status: BusinessPlanAssignmentStatus;
  startedAt: string;
  updatedAt: string;
  source: string;
};

export type BusinessPlanAssignmentRepository = {
  save(entity: BusinessPlanAssignment): Promise<void>;
  findCurrent(businessId: string): Promise<BusinessPlanAssignment | null>;
  listByBusiness(businessId: string): Promise<BusinessPlanAssignment[]>;
};
