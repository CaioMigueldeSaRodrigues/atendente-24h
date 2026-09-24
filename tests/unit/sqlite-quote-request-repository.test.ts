import assert from "node:assert/strict";
import test from "node:test";
import type { AutomotiveBusiness, Conversation, Opportunity, QuoteRequest } from "../../src/core/domain/entities.js";
import { BusinessType, Channel, ConversationStatus, OpportunityStatus, QuoteRequestStatus } from "../../src/core/domain/enums.js";
import type { QuoteRequestRepository } from "../../src/core/repositories.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { SqliteOpportunityRepository } from "../../src/infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteQuoteRequestRepository } from "../../src/infrastructure/sqlite/sqlite-quote-request-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";

const business = (id: string): AutomotiveBusiness => ({
  id, name: `Business ${id}`, businessType: BusinessType.OTHER, timezone: "UTC", active: true,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const conversation = (id: string, businessId: string): Conversation => ({
  id, businessId, channel: Channel.WEB, status: ConversationStatus.ACTIVE,
  startedAt: "2026-01-01T00:00:00.000Z", lastMessageAt: "2026-01-01T00:00:00.000Z",
});
const opportunity = (id: string, businessId: string, conversationId: string): Opportunity => ({
  id, businessId, conversationId, status: OpportunityStatus.OPEN,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const quote = (id: string, businessId: string, opportunityId = "opportunity-1",
  conversationId = "conversation-1", overrides: Partial<QuoteRequest> = {}): QuoteRequest => ({
  id, businessId, opportunityId, conversationId, requestDescription: `Request ${id}`,
  status: QuoteRequestStatus.WAITING_BUSINESS, requestedAt: "2026-01-02T00:00:00.000Z",
  createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", ...overrides,
});

const withRepositories = async (run: (
  quotes: SqliteQuoteRequestRepository,
  opportunities: SqliteOpportunityRepository,
  businesses: SqliteAutomotiveBusinessRepository,
  conversations: SqliteConversationRepository,
  database: ReturnType<typeof createSqliteDatabase>,
) => Promise<void>) => {
  const database = createSqliteDatabase({ filename: ":memory:" });
  try {
    await run(new SqliteQuoteRequestRepository(database), new SqliteOpportunityRepository(database),
      new SqliteAutomotiveBusinessRepository(database), new SqliteConversationRepository(database), database);
  } finally { database.close(); }
};

const seedBase = async (opportunities: SqliteOpportunityRepository,
  businesses: SqliteAutomotiveBusinessRepository, conversations: SqliteConversationRepository,
  businessId: string, oppId = "opportunity-1", convId = "conversation-1") => {
  await businesses.save(business(businessId));
  await conversations.save(conversation(convId, businessId));
  await opportunities.save(opportunity(oppId, businessId, convId));
};

test("satisfies QuoteRequestRepository and round-trips a quote request", async () => {
  await withRepositories(async (quotes, opportunities, businesses, conversations) => {
    const contract: QuoteRequestRepository = quotes;
    await seedBase(opportunities, businesses, conversations, "business-a");
    const entity = quote("quote-1", "business-a");
    await contract.save(entity);
    assert.deepEqual(await contract.findById(entity.businessId, entity.id), entity);
  });
});

test("listByConversation filters tenant and conversation, sorting requested_at then id", async () => {
  await withRepositories(async (quotes, opportunities, businesses, conversations) => {
    await seedBase(opportunities, businesses, conversations, "business-a");
    await seedBase(opportunities, businesses, conversations, "business-b");
    await conversations.save(conversation("conversation-2", "business-a"));
    await opportunities.save(opportunity("opportunity-2", "business-a", "conversation-2"));
    const late = quote("z-late", "business-a", "opportunity-1", "conversation-1", { requestedAt: "2026-01-03T00:00:00.000Z" });
    const tieB = quote("b-tie", "business-a", "opportunity-1", "conversation-1", { requestedAt: "2026-01-02T00:00:00.000Z" });
    const tieA = quote("a-tie", "business-a", "opportunity-1", "conversation-1", { requestedAt: "2026-01-02T00:00:00.000Z" });
    const otherConversation = quote("other-conversation", "business-a", "opportunity-2", "conversation-2");
    const otherBusiness = quote("other-business", "business-b");
    for (const item of [late, tieB, tieA, otherConversation, otherBusiness]) await quotes.save(item);
    assert.deepEqual((await quotes.listByConversation("business-a", "conversation-1")).map((item) => item.id), ["a-tie", "b-tie", "z-late"]);
    assert.deepEqual(await quotes.listByConversation("business-b", "conversation-1"), [otherBusiness]);
  });
});

test("composite identity allows same request id per business and optionals are omitted", async () => {
  await withRepositories(async (quotes, opportunities, businesses, conversations, database) => {
    await seedBase(opportunities, businesses, conversations, "business-a");
    await seedBase(opportunities, businesses, conversations, "business-b");
    const first = quote("shared", "business-a");
    const second = quote("shared", "business-b");
    await quotes.save(first);
    await quotes.save(second);
    assert.deepEqual(await quotes.findById("business-a", first.id), first);
    assert.deepEqual(await quotes.findById("business-b", second.id), second);
    assert.equal(await quotes.findById("business-c", first.id), null);
    const stored = database.prepare(`SELECT customer_id, vehicle_id, symptom_description, responded_at,
      authorized_price_amount_cents, authorized_price_currency FROM quote_requests WHERE business_id = ? AND id = ?`).get("business-a", first.id);
    assert.deepEqual(stored && { ...stored }, { customer_id: null, vehicle_id: null, symptom_description: null,
      responded_at: null, authorized_price_amount_cents: null, authorized_price_currency: null });
  });
});

test("authorized price preserves exact cents including zero and optional timestamps", async () => {
  await withRepositories(async (quotes, opportunities, businesses, conversations, database) => {
    await seedBase(opportunities, businesses, conversations, "business-a");
    const priced = quote("priced", "business-a", "opportunity-1", "conversation-1", {
      authorizedPrice: { amountCents: 125050, currency: "BRL" }, symptomDescription: "Ruído ao frear",
      respondedAt: "2026-01-04T00:00:00.000Z", status: QuoteRequestStatus.RESPONDED,
    });
    const zero = quote("zero", "business-a", "opportunity-1", "conversation-1", { authorizedPrice: { amountCents: 0, currency: "BRL" } });
    await quotes.save(priced);
    await quotes.save(zero);
    assert.deepEqual(await quotes.findById(priced.businessId, priced.id), priced);
    assert.deepEqual(await quotes.findById(zero.businessId, zero.id), zero);
    const stored = database.prepare("SELECT authorized_price_amount_cents FROM quote_requests WHERE business_id = ? AND id = ?").get("business-a", "priced");
    assert.deepEqual(stored && { ...stored }, { authorized_price_amount_cents: 125050 });
  });
});

test("invalid status, currency, and partial authorized prices fail on load", async (t) => {
  const cases = [
    { status: "INVALID_STATUS", amount: null, currency: null },
    { status: QuoteRequestStatus.REQUESTED, amount: 100, currency: null },
    { status: QuoteRequestStatus.REQUESTED, amount: null, currency: "BRL" },
    { status: QuoteRequestStatus.REQUESTED, amount: 100, currency: "USD" },
  ] as const;
  for (const [index, item] of cases.entries()) await t.test(`case ${index + 1}`, async () => {
    await withRepositories(async (quotes, opportunities, businesses, conversations, database) => {
      await seedBase(opportunities, businesses, conversations, "business-a");
      const entity = quote("quote-1", "business-a");
      await quotes.save(entity);
      database.prepare(`UPDATE quote_requests SET status = ?, authorized_price_amount_cents = ?,
        authorized_price_currency = ? WHERE business_id = ? AND id = ?`)
        .run(item.status, item.amount, item.currency, entity.businessId, entity.id);
      await assert.rejects(quotes.findById(entity.businessId, entity.id), { message: "Failed to load QuoteRequest" });
    });
  });
});

test("foreign keys reject cross-business Opportunity and Conversation links", async (t) => {
  await t.test("Opportunity from another business", async () => {
    await withRepositories(async (quotes, opportunities, businesses, conversations) => {
      await seedBase(opportunities, businesses, conversations, "business-a");
      await seedBase(opportunities, businesses, conversations, "business-b", "opportunity-b", "conversation-b");
      await assert.rejects(quotes.save(quote("quote-1", "business-a", "opportunity-b")), { message: "Failed to save QuoteRequest" });
    });
  });
  await t.test("Conversation from another business", async () => {
    await withRepositories(async (quotes, opportunities, businesses, conversations) => {
      await seedBase(opportunities, businesses, conversations, "business-a");
      await seedBase(opportunities, businesses, conversations, "business-b", "opportunity-b", "conversation-b");
      await assert.rejects(quotes.save(quote("quote-1", "business-a", "opportunity-1", "conversation-b")), { message: "Failed to save QuoteRequest" });
    });
  });
});
