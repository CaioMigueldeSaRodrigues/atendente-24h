import assert from "node:assert/strict";
import test from "node:test";
import { AdminPlan } from "../../src/core/admin-plan-entitlement.js";
import { createPreviewAdminDependencies } from "../../src/app/admin-preview-fixture.js";
import { SqliteBusinessPlanAssignmentRepository } from "../../src/infrastructure/sqlite/sqlite-business-plan-assignment-repository.js";
import { SqlitePlatformAdminReadModel } from "../../src/infrastructure/sqlite/sqlite-platform-admin-read-model.js";
import { aggregatePlatformQuoteBenchmark } from "../../src/core/platform-admin-read-model.js";

test("Super Admin platform read model sees all workshop plans and does not fabricate geography", async () => {
  const preview = createPreviewAdminDependencies();
  try {
    const overview = await preview.platformQueryService.getOverview({});
    assert.equal(overview.businesses.total, 3);
    assert.deepEqual(overview.plans.map((item) => [item.plan, item.businesses]), [[AdminPlan.BASIC, 1], [AdminPlan.INTERMEDIATE, 1], [AdminPlan.ADVANCED, 1]]);
    assert.equal(overview.mostAdoptedPlan, null);
    assert.equal(overview.geography.status, "NOT_AVAILABLE");
    assert.equal((await preview.platformQueryService.getOverview({ plan: AdminPlan.BASIC })).businesses.total, 1);
    assert.equal((await preview.platformQueryService.getOverview({ plan: AdminPlan.BASIC })).metrics.quotes.value?.businessesWithQuoteData, 0);
    assert.equal((await preview.platformQueryService.getOverview({ plan: AdminPlan.ADVANCED })).metrics.quotes.value?.businessesWithQuoteData, 1);
    const fixedReadModel = new SqlitePlatformAdminReadModel(preview.database, { now: () => "2026-09-29T13:00:00.000Z" });
    const metrics = (await fixedReadModel.getOverview({ businessId: "preview-business" })).metrics;
    assert.equal(metrics.requests.value?.total, 4);
    assert.deepEqual(metrics.pendingRequests.value, { total: 1, underOneHour: 0, betweenOneAndTwoHours: 0, overTwoHours: 1 });
    assert.deepEqual(metrics.quotes.value, {
      lowerReferenceCents: null,
      observedAverageCents: 93000,
      medianCents: 93000,
      upperReferenceCents: null,
      totalAuthorizedCents: 279000,
      globalAverageCents: 93000,
      businessesWithQuoteData: 1,
      quotesWithValue: 3,
      currency: "BRL",
      benchmarkStatus: "INSUFFICIENT_DATA",
    });
    assert.equal(metrics.activeAttendants.status, "NOT_AVAILABLE");
    assert.equal(metrics.abandonmentByDelay.status, "NOT_AVAILABLE");
    assert.equal(metrics.satisfaction.status, "NOT_AVAILABLE");
    assert.equal(metrics.efficiency.status, "NOT_AVAILABLE");
    const growth = (await fixedReadModel.getOverview({ businessId: "preview-business", period: { from: "2026-09-29T10:00:00.000Z", to: "2026-09-29T11:00:00.000Z" } })).metrics.attendanceGrowth;
    assert.equal(growth.value?.comparisonStatus, "NOT_AVAILABLE");
  } finally {
    preview.database.close();
  }
});

test("quote benchmark calculates the average per workshop before the aggregate", () => {
  const benchmark = aggregatePlatformQuoteBenchmark([
    ...Array.from({ length: 10 }, () => ({ businessId: "many-quotes", amountCents: 10000 })),
    { businessId: "one-quote", amountCents: 30000 },
  ]);
  assert.equal(benchmark.observedAverageCents, 20000);
  assert.equal(benchmark.globalAverageCents, 11818);
  assert.equal(benchmark.businessesWithQuoteData, 2);
  assert.equal(benchmark.quotesWithValue, 11);
});

test("quote benchmark references and median use workshop tickets, without workshop identity", () => {
  const benchmark = aggregatePlatformQuoteBenchmark([
    { businessId: "workshop-a", amountCents: 10000 },
    { businessId: "workshop-b", amountCents: 30000 },
    { businessId: "workshop-c", amountCents: 50000 },
  ]);
  assert.equal(benchmark.lowerReferenceCents, 10000);
  assert.equal(benchmark.observedAverageCents, 30000);
  assert.equal(benchmark.medianCents, 30000);
  assert.equal(benchmark.upperReferenceCents, 50000);
  assert.equal(benchmark.benchmarkStatus, "AVAILABLE");
  assert.equal("businessId" in benchmark, false);
  assert.equal("workshop-a" in benchmark, false);
});

test("one workshop keeps operational totals but marks the benchmark references insufficient", () => {
  const benchmark = aggregatePlatformQuoteBenchmark([
    { businessId: "only-workshop", amountCents: 10000 },
    { businessId: "only-workshop", amountCents: 30000 },
  ]);
  assert.equal(benchmark.businessesWithQuoteData, 1);
  assert.equal(benchmark.quotesWithValue, 2);
  assert.equal(benchmark.totalAuthorizedCents, 40000);
  assert.equal(benchmark.globalAverageCents, 20000);
  assert.equal(benchmark.observedAverageCents, 20000);
  assert.equal(benchmark.medianCents, 20000);
  assert.equal(benchmark.lowerReferenceCents, null);
  assert.equal(benchmark.upperReferenceCents, null);
  assert.equal(benchmark.benchmarkStatus, "INSUFFICIENT_DATA");
});

test("BusinessPlanAssignment keeps current plan and historical rows tenant-scoped", async () => {
  const preview = createPreviewAdminDependencies();
  try {
    const repository = new SqliteBusinessPlanAssignmentRepository(preview.database);
    await repository.save({ id: "preview-business-old-plan", businessId: "preview-business", plan: AdminPlan.BASIC, status: "ENDED", startedAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z", source: "test" });
    const current = await repository.findCurrent("preview-business");
    assert.equal(current?.plan, AdminPlan.ADVANCED);
    assert.equal((await repository.listByBusiness("preview-business")).length, 2);
    assert.equal(await repository.findCurrent("other-business"), null);
  } finally {
    preview.database.close();
  }
});
