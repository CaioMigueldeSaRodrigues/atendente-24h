import assert from "node:assert/strict";
import test from "node:test";
import {
  BusinessType,
  Channel,
  ConversationStatus,
  OpportunityStatus,
  SenderType,
} from "../../src/core/domain/enums.js";
import type {
  AutomotiveBusiness,
  Conversation,
  Customer,
  Message,
  Opportunity,
} from "../../src/core/domain/entities.js";
import {
  InMemoryAutomotiveBusinessRepository,
  InMemoryConversationRepository,
  InMemoryCustomerRepository,
  InMemoryMessageRepository,
  InMemoryOpportunityRepository,
} from "../../src/core/in-memory-repositories.js";

const business = (id: string): AutomotiveBusiness => ({
  id,
  name: `Business ${id}`,
  businessType: BusinessType.OTHER,
  timezone: "America/Sao_Paulo",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const customer = (id: string, businessId: string, name = "Cliente"): Customer => ({
  id,
  businessId,
  name,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const conversation = (id: string, businessId: string): Conversation => ({
  id,
  businessId,
  channel: Channel.WEB,
  status: ConversationStatus.ACTIVE,
  startedAt: "2026-01-01T00:00:00.000Z",
  lastMessageAt: "2026-01-01T00:00:00.000Z",
});

const message = (
  id: string,
  businessId: string,
  conversationId: string,
  content: string,
): Message => ({
  id,
  businessId,
  conversationId,
  senderType: SenderType.CUSTOMER,
  channel: Channel.WEB,
  content,
  createdAt: "2026-01-01T00:00:00.000Z",
});

test("saves and retrieves an AutomotiveBusiness", async () => {
  const repository = new InMemoryAutomotiveBusinessRepository();
  const entity = business("business-a");

  await repository.save(entity);

  assert.deepEqual(await repository.findById(entity.id), entity);
});

test("saves and retrieves a Customer for its business", async () => {
  const repository = new InMemoryCustomerRepository();
  const entity = customer("customer-1", "business-a");

  await repository.save(entity);

  assert.deepEqual(await repository.findById("business-a", entity.id), entity);
});

test("does not retrieve a Customer through another business", async () => {
  const repository = new InMemoryCustomerRepository();
  const entity = customer("customer-1", "business-a");
  await repository.save(entity);

  assert.equal(await repository.findById("business-b", entity.id), null);
});

test("saves and retrieves a Conversation for its business", async () => {
  const repository = new InMemoryConversationRepository();
  const entity = conversation("conversation-1", "business-a");

  await repository.save(entity);

  assert.deepEqual(
    await repository.findById("business-a", entity.id),
    entity,
  );
});

test("saves multiple Messages and lists them by conversation", async () => {
  const repository = new InMemoryMessageRepository();
  const first = message("message-1", "business-a", "conversation-1", "Olá");
  const second = message("message-2", "business-a", "conversation-1", "Oi");
  const otherConversation = message(
    "message-3",
    "business-a",
    "conversation-2",
    "Outra conversa",
  );
  await repository.save(first);
  await repository.save(second);
  await repository.save(otherConversation);

  assert.deepEqual(
    await repository.listByConversation("business-a", "conversation-1"),
    [first, second],
  );
});

test("does not list another business's Messages in the same conversation query", async () => {
  const repository = new InMemoryMessageRepository();
  const entity = message("message-1", "business-a", "conversation-1", "Olá");
  await repository.save(entity);

  assert.deepEqual(
    await repository.listByConversation("business-b", "conversation-1"),
    [],
  );
});

test("replaces an entity with the same id", async () => {
  const repository = new InMemoryCustomerRepository();
  await repository.save(customer("customer-1", "business-a", "Nome antigo"));
  const updated = customer("customer-1", "business-a", "Nome atualizado");

  await repository.save(updated);

  assert.deepEqual(
    await repository.findById("business-a", "customer-1"),
    updated,
  );
});

test("saves and retrieves an Opportunity for its business", async () => {
  const repository = new InMemoryOpportunityRepository();
  const entity: Opportunity = {
    id: "opportunity-1",
    businessId: "business-a",
    conversationId: "conversation-1",
    status: OpportunityStatus.OPEN,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  await repository.save(entity);

  assert.deepEqual(
    await repository.findById("business-a", entity.id),
    entity,
  );
});
