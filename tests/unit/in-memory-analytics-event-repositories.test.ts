import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantHealthEvent, CommercialEvent } from "../../src/core/domain/entities.js";
import { AssistantHealthEventType, BusinessType, Channel, CommercialEventType, CommercialOutcome, Intent } from "../../src/core/domain/enums.js";
import type { AssistantHealthEventRepository, CommercialEventRepository } from "../../src/core/repositories.js";
import { InMemoryAssistantHealthEventRepository, InMemoryCommercialEventRepository } from "../../src/core/in-memory-repositories.js";

const commercial = (id: string, businessId: string, overrides: Partial<CommercialEvent> = {}): CommercialEvent => ({
  id,
  businessId,
  eventType: CommercialEventType.QUOTE_REQUESTED,
  occurredAt: "2026-01-02T00:00:00.000Z",
  ...overrides,
});

const health = (id: string, businessId: string, overrides: Partial<AssistantHealthEvent> = {}): AssistantHealthEvent => ({
  id,
  businessId,
  eventType: AssistantHealthEventType.LOW_CONFIDENCE,
  occurredAt: "2026-01-02T00:00:00.000Z",
  ...overrides,
});

test("InMemoryCommercialEventRepository satisfies its contract, appends immutably and isolates businesses", async () => {
  const repository: CommercialEventRepository = new InMemoryCommercialEventRepository();
  const first = commercial("shared", "business-a", {
    eventType: CommercialEventType.SYMPTOM_REPORTED,
    conversationId: "conversation-a",
    channel: Channel.WEB,
    intent: Intent.SYMPTOM_REPORT,
    commercialOutcome: CommercialOutcome.OPPORTUNITY,
    businessType: BusinessType.WORKSHOP,
    country: "BR", state: "SP", city: "Campinas", region: "Sudeste",
    category: "Freios", requestedItem: "Pastilhas", symptom: "Ruído ao frear",
    vehicleBrand: "Toyota", vehicleModel: "Corolla", vehicleYear: 2020,
    amount: { amountCents: 125050, currency: "BRL" },
  });
  await repository.append(first);
  await repository.append(commercial("shared", "business-b"));
  await repository.append(commercial("late", "business-a", { occurredAt: "2026-01-03T00:00:00.000Z" }));
  await repository.append(commercial("tie-b", "business-a", { occurredAt: first.occurredAt }));
  await repository.append(commercial("tie-a", "business-a", { occurredAt: first.occurredAt }));

  assert.deepEqual(await repository.listByBusiness("business-a"), [
    first,
    commercial("tie-a", "business-a"),
    commercial("tie-b", "business-a"),
    commercial("late", "business-a", { occurredAt: "2026-01-03T00:00:00.000Z" }),
  ]);
  assert.deepEqual((await repository.listByBusiness("business-b")).map((event) => event.id), ["shared"]);
  assert.deepEqual((await repository.listByConversation("business-a", "conversation-a")).map((event) => event.id), ["shared"]);
  assert.deepEqual(await repository.listByConversation("business-b", "conversation-a"), []);
  await assert.rejects(repository.append(first), { message: "Failed to append CommercialEvent" });

  const returned = await repository.listByBusiness("business-a");
  const priced = returned[0];
  assert.ok(priced?.amount);
  priced.amount.amountCents = 1;
  returned.pop();
  assert.equal((await repository.listByBusiness("business-a"))[0]?.amount?.amountCents, 125050);
  assert.equal((await repository.listByBusiness("business-a")).length, 4);
});

test("InMemoryAssistantHealthEventRepository satisfies its contract, orders events and isolates businesses", async () => {
  const repository: AssistantHealthEventRepository = new InMemoryAssistantHealthEventRepository();
  const first = health("shared", "business-a", {
    conversationId: "conversation-a", eventType: AssistantHealthEventType.AI_FAILURE,
    channel: Channel.WHATSAPP, businessType: BusinessType.AUTO_CENTER,
    country: "BR", state: "MG", city: "Belo Horizonte", region: "Sudeste",
    provider: "provider-x", model: "model-y", reason: "PROVIDER_UNAVAILABLE",
  });
  await repository.append(first);
  await repository.append(health("shared", "business-b"));
  await repository.append(health("z", "business-a", { occurredAt: first.occurredAt }));
  await repository.append(health("a", "business-a", { occurredAt: first.occurredAt }));
  await repository.append(health("late", "business-a", { occurredAt: "2026-01-04T00:00:00.000Z" }));

  assert.deepEqual(await repository.listByBusiness("business-a"), [
    health("a", "business-a", { occurredAt: first.occurredAt }), first,
    health("z", "business-a", { occurredAt: first.occurredAt }),
    health("late", "business-a", { occurredAt: "2026-01-04T00:00:00.000Z" }),
  ]);
  assert.deepEqual((await repository.listByBusiness("business-b")).map((event) => event.id), ["shared"]);
  assert.deepEqual((await repository.listByConversation("business-a", "conversation-a")).map((event) => event.id), ["shared"]);
  assert.deepEqual(await repository.listByConversation("business-b", "conversation-a"), []);
  await assert.rejects(repository.append(first), { message: "Failed to append AssistantHealthEvent" });
  const results = await repository.listByBusiness("business-a");
  results[1]!.reason = "MUTATED";
  results.pop();
  assert.equal((await repository.listByBusiness("business-a"))[1]?.reason, "PROVIDER_UNAVAILABLE");
  assert.equal((await repository.listByBusiness("business-a")).length, 4);
});

test("event domain objects contain no direct personal information fields", () => {
  type Forbidden = "customerName" | "phone" | "email" | "licensePlate" | "messageContent" | "fullMessage";
  type NoDirectPii<T> = Extract<keyof T, Forbidden> extends never ? true : never;
  const commercialHasNoDirectPii: NoDirectPii<CommercialEvent> = true;
  const healthHasNoDirectPii: NoDirectPii<AssistantHealthEvent> = true;
  assert.equal(commercialHasNoDirectPii && healthHasNoDirectPii, true);
});
