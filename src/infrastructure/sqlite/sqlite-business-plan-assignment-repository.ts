import type { DatabaseSync } from "node:sqlite";
import { AdminPlan } from "../../core/admin-plan-entitlement.js";
import type { BusinessPlanAssignment, BusinessPlanAssignmentRepository } from "../../core/business-plan.js";
import { withSqliteConnectionLock } from "./sqlite-connection-lock.js";

export class SqliteBusinessPlanAssignmentRepository implements BusinessPlanAssignmentRepository {
  constructor(private readonly database: DatabaseSync) {}

  async save(entity: BusinessPlanAssignment): Promise<void> {
    try {
      await withSqliteConnectionLock(this.database, () => this.database.prepare(`
        INSERT INTO business_plan_assignments(id,business_id,plan,status,started_at,updated_at,source)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(business_id,id) DO UPDATE SET plan=excluded.plan,status=excluded.status,started_at=excluded.started_at,updated_at=excluded.updated_at,source=excluded.source
      `).run(entity.id, entity.businessId, entity.plan, entity.status, entity.startedAt, entity.updatedAt, entity.source));
    } catch {
      throw new Error("Failed to save BusinessPlanAssignment");
    }
  }

  async findCurrent(businessId: string): Promise<BusinessPlanAssignment | null> {
    const row = this.database.prepare("SELECT * FROM business_plan_assignments WHERE business_id = ? AND status = 'ACTIVE'").get(businessId) as Record<string, unknown> | undefined;
    return row === undefined ? null : this.map(row);
  }

  async listByBusiness(businessId: string): Promise<BusinessPlanAssignment[]> {
    const rows = this.database.prepare("SELECT * FROM business_plan_assignments WHERE business_id = ? ORDER BY started_at ASC,id ASC").all(businessId) as Record<string, unknown>[];
    return rows.map((row) => this.map(row));
  }

  private map(row: Record<string, unknown>): BusinessPlanAssignment {
    const plan = String(row.plan);
    if (!Object.values(AdminPlan).includes(plan as AdminPlan)) throw new Error("Invalid BusinessPlanAssignment plan");
    const status = String(row.status);
    if (status !== "ACTIVE" && status !== "ENDED") throw new Error("Invalid BusinessPlanAssignment status");
    return { id: String(row.id), businessId: String(row.business_id), plan: plan as AdminPlan, status: status as BusinessPlanAssignment["status"], startedAt: String(row.started_at), updatedAt: String(row.updated_at), source: String(row.source) };
  }
}
