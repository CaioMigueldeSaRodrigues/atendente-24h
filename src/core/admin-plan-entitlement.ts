export const AdminPlan = {
  BASIC: "BASIC",
  INTERMEDIATE: "INTERMEDIATE",
  ADVANCED: "ADVANCED",
} as const;

export type AdminPlan = typeof AdminPlan[keyof typeof AdminPlan];
