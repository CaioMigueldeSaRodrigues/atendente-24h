import type { BusinessPlanAssignment, BusinessPlanAssignmentRepository } from "../../core/business-plan.js";
import { AdminPlan } from "../../core/admin-plan-entitlement.js";
import type { PostgresDatabase } from "./postgres-database.js";

type Row = Record<string, unknown>;

export class PostgresBusinessPlanAssignmentRepository implements BusinessPlanAssignmentRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async save(entity: BusinessPlanAssignment): Promise<void> {
    await this.database.query(`
      INSERT INTO business_plan_assignments(id,business_id,plan,status,started_at,updated_at,source)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (business_id,id) DO UPDATE SET plan=excluded.plan,status=excluded.status,
        started_at=excluded.started_at,updated_at=excluded.updated_at,source=excluded.source
    `, [entity.id, entity.businessId, entity.plan, entity.status, entity.startedAt, entity.updatedAt, entity.source]);
  }

  async findCurrent(businessId: string): Promise<BusinessPlanAssignment | null> {
    const result = await this.database.query<Row>("SELECT * FROM business_plan_assignments WHERE business_id=$1 AND status='ACTIVE'", [businessId]);
    return result.rows[0] === undefined ? null : map(result.rows[0]);
  }

  async listByBusiness(businessId: string): Promise<BusinessPlanAssignment[]> {
    const result = await this.database.query<Row>("SELECT * FROM business_plan_assignments WHERE business_id=$1 ORDER BY started_at ASC,id ASC", [businessId]);
    return result.rows.map(map);
  }
}

function map(row: Row): BusinessPlanAssignment {
  const plan = String(row.plan);
  if (!Object.values(AdminPlan).includes(plan as BusinessPlanAssignment["plan"])) throw new Error("Invalid BusinessPlanAssignment plan");
  const status = String(row.status);
  if (status !== "ACTIVE" && status !== "ENDED") throw new Error("Invalid BusinessPlanAssignment status");
  return { id: String(row.id), businessId: String(row.business_id), plan: plan as BusinessPlanAssignment["plan"], status: status as BusinessPlanAssignment["status"], startedAt: String(row.started_at), updatedAt: String(row.updated_at), source: String(row.source) };
}
