import assert from "node:assert/strict";
import test from "node:test";
import type { OutboundDelivery } from "../../src/core/domain/entities.js";
import { BusinessType, Channel, ConversationStatus, OpportunityStatus, OutboundDeliveryStatus, QuoteRequestStatus, SenderType } from "../../src/core/domain/enums.js";
import { SqliteAutomotiveBusinessRepository } from "../../src/infrastructure/sqlite/sqlite-automotive-business-repository.js";
import { SqliteConversationRepository } from "../../src/infrastructure/sqlite/sqlite-conversation-repository.js";
import { createSqliteDatabase } from "../../src/infrastructure/sqlite/sqlite-database.js";
import { SqliteMessageRepository } from "../../src/infrastructure/sqlite/sqlite-message-repository.js";
import { SqliteOpportunityRepository } from "../../src/infrastructure/sqlite/sqlite-opportunity-repository.js";
import { SqliteOutboundDeliveryRepository } from "../../src/infrastructure/sqlite/sqlite-outbound-delivery-repository.js";
import { SqliteQuoteRequestRepository } from "../../src/infrastructure/sqlite/sqlite-quote-request-repository.js";

const timestamp = "2026-10-01T12:00:00.000Z";

async function createFixture() {
  const database = createSqliteDatabase({ filename: ":memory:" });
  const businesses = new SqliteAutomotiveBusinessRepository(database);
  const conversations = new SqliteConversationRepository(database);
  const messages = new SqliteMessageRepository(database);
  const opportunities = new SqliteOpportunityRepository(database);
  const quotes = new SqliteQuoteRequestRepository(database);
  await businesses.save({
    id: "business-a", name: "Oficina A", businessType: BusinessType.WORKSHOP,
    timezone: "UTC", active: true, createdAt: timestamp, updatedAt: timestamp,
  });
  await businesses.save({
    id: "business-b", name: "Oficina B", businessType: BusinessType.WORKSHOP,
    timezone: "UTC", active: true, createdAt: timestamp, updatedAt: timestamp,
  });
  await conversations.save({
    id: "conversation-a", businessId: "business-a", channel: Channel.WHATSAPP,
    status: ConversationStatus.ACTIVE, startedAt: timestamp, lastMessageAt: timestamp,
  });
  await conversations.save({
    id: "conversation-b", businessId: "business-b", channel: Channel.WHATSAPP,
    status: ConversationStatus.ACTIVE, startedAt: timestamp, lastMessageAt: timestamp,
  });
  await messages.save({
    id: "message-a", businessId: "business-a", conversationId: "conversation-a",
    senderType: SenderType.ASSISTANT, channel: Channel.WHATSAPP, content: "quote", createdAt: timestamp,
  });
  await messages.save({
    id: "message-b", businessId: "business-b", conversationId: "conversation-b",
    senderType: SenderType.ASSISTANT, channel: Channel.WHATSAPP, content: "quote", createdAt: timestamp,
  });
  await opportunities.save({
    id: "opportunity-a", businessId: "business-a", conversationId: "conversation-a",
    status: OpportunityStatus.WAITING_CUSTOMER, createdAt: timestamp, updatedAt: timestamp,
  });
  await opportunities.save({
    id: "opportunity-b", businessId: "business-b", conversationId: "conversation-b",
    status: OpportunityStatus.WAITING_CUSTOMER, createdAt: timestamp, updatedAt: timestamp,
  });
  await quotes.save({
    id: "quote-a", businessId: "business-a", opportunityId: "opportunity-a", conversationId: "conversation-a",
    requestDescription: "Troca de óleo", status: QuoteRequestStatus.RESPONDED, requestedAt: timestamp,
    createdAt: timestamp, updatedAt: timestamp,
  });
  await quotes.save({
    id: "quote-b", businessId: "business-b", opportunityId: "opportunity-b", conversationId: "conversation-b",
    requestDescription: "Troca de óleo", status: QuoteRequestStatus.RESPONDED, requestedAt: timestamp,
    createdAt: timestamp, updatedAt: timestamp,
  });
  return { database, repository: new SqliteOutboundDeliveryRepository(database) };
}

function delivery(overrides: Partial<OutboundDelivery> = {}): OutboundDelivery {
  return {
    id: "delivery-a",
    businessId: "business-a",
    messageId: "message-a",
    quoteRequestId: "quote-a",
    conversationId: "conversation-a",
    channel: Channel.WHATSAPP,
    recipientRef: "5511999990000@s.whatsapp.net",
    status: OutboundDeliveryStatus.PENDING,
    attempts: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

test("persists outbound delivery fields and enforces logical uniqueness", async () => {
  const fixture = await createFixture();
  try {
    const first = await fixture.repository.create(delivery());
    const duplicate = await fixture.repository.create(delivery({ id: "delivery-duplicate" }));
    assert.deepEqual(duplicate, first);
    assert.equal(await fixture.repository.findByMessageAndChannel("business-a", "message-a", Channel.WHATSAPP)
      .then((value) => value?.id), "delivery-a");
    assert.equal(await fixture.repository.findByMessageAndChannel("business-b", "message-a", Channel.WHATSAPP), null);

    const otherBusiness = await fixture.repository.create(delivery({
      id: "delivery-b", businessId: "business-b", messageId: "message-b",
      quoteRequestId: "quote-b", conversationId: "conversation-b",
    }));
    assert.equal(otherBusiness.id, "delivery-b");
    assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get()?.count, 2);
  } finally {
    fixture.database.close();
  }
});

test("claim is atomic and only one concurrent attempt enters SENDING", async () => {
  const fixture = await createFixture();
  try {
    await fixture.repository.create(delivery());
    const secondRepository = new SqliteOutboundDeliveryRepository(fixture.database);
    const [first, second] = await Promise.all([
      fixture.repository.claimForSending("business-a", "delivery-a", "2026-10-01T12:01:00.000Z", "2026-10-01T12:02:00.000Z", "claim-a"),
      secondRepository.claimForSending("business-a", "delivery-a", "2026-10-01T12:01:00.000Z", "2026-10-01T12:02:00.000Z", "claim-b"),
    ]);
    assert.equal([first.claimed, second.claimed].filter(Boolean).length, 1);
    assert.equal(first.delivery.status, OutboundDeliveryStatus.SENDING);
    assert.equal(second.delivery.status, OutboundDeliveryStatus.SENDING);
    assert.equal(first.delivery.attempts, 1);
    assert.equal(second.delivery.attempts, 1);
  } finally {
    fixture.database.close();
  }
});

test("failed retryable delivery can be claimed again and becomes delivered", async () => {
  const fixture = await createFixture();
  try {
    await fixture.repository.create(delivery());
    const firstClaim = await fixture.repository.claimForSending("business-a", "delivery-a", "2026-10-01T12:01:00.000Z", "2026-10-01T12:02:00.000Z", "claim-a");
    await fixture.repository.markFailed("business-a", "delivery-a", {
      status: OutboundDeliveryStatus.FAILED_RETRYABLE,
      lastError: "synthetic sender failure",
      nextAttemptAt: "2026-10-01T12:01:00.000Z",
      updatedAt: "2026-10-01T12:01:00.000Z",
    }, firstClaim.delivery.claimToken!);
    const retry = await fixture.repository.claimForSending("business-a", "delivery-a", "2026-10-01T12:02:00.000Z", "2026-10-01T12:03:00.000Z", "claim-b");
    assert.equal(retry.claimed, true);
    assert.equal(retry.delivery.attempts, 2);
    const delivered = await fixture.repository.markDelivered(
      "business-a", "delivery-a", "2026-10-01T12:02:01.000Z", "2026-10-01T12:02:01.000Z", retry.delivery.claimToken!,
    );
    assert.equal(delivered.status, OutboundDeliveryStatus.DELIVERED);
    assert.equal(delivered.deliveredAt, "2026-10-01T12:02:01.000Z");
    const again = await fixture.repository.claimForSending("business-a", "delivery-a", "2026-10-01T12:03:00.000Z", "2026-10-01T12:04:00.000Z", "claim-c");
    assert.equal(again.claimed, false);
    assert.equal(again.delivery.attempts, 2);
  } finally {
    fixture.database.close();
  }
});

test("lease expirada permite recuperação e claim antigo não pode finalizar", async () => {
  const fixture = await createFixture();
  try {
    await fixture.repository.create(delivery());
    const first = await fixture.repository.claimForSending("business-a", "delivery-a", "2026-10-01T12:01:00.000Z", "2026-10-01T12:01:30.000Z", "claim-a");
    const blocked = await fixture.repository.claimForSending("business-a", "delivery-a", "2026-10-01T12:01:10.000Z", "2026-10-01T12:01:40.000Z", "claim-b");
    assert.equal(blocked.claimed, false);
    const recovered = await fixture.repository.claimForSending("business-a", "delivery-a", "2026-10-01T12:02:00.000Z", "2026-10-01T12:02:30.000Z", "claim-b");
    assert.equal(recovered.claimed, true);
    assert.equal(recovered.delivery.attempts, 2);
    await assert.rejects(() => fixture.repository.markDelivered("business-a", "delivery-a", "2026-10-01T12:02:01.000Z", "2026-10-01T12:02:01.000Z", first.delivery.claimToken!));
    const delivered = await fixture.repository.markDelivered("business-a", "delivery-a", "2026-10-01T12:02:02.000Z", "2026-10-01T12:02:02.000Z", recovered.delivery.claimToken!);
    assert.equal(delivered.status, OutboundDeliveryStatus.DELIVERED);
    assert.equal(delivered.attempts, 2);
  } finally {
    fixture.database.close();
  }
});
