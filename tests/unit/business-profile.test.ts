import assert from "node:assert/strict";
import test from "node:test";
import {
  BusinessProfileError, buildBusinessFacts, closedNotice, formatLocalDateTime, isOpenAt, nextOpening, parseBusinessProfileInput,
  type BusinessProfile,
} from "../../src/core/business-profile.js";

const weekday = [{ open: "08:00", close: "18:00" }];
const profile: BusinessProfile = {
  businessId: "business-a",
  address: "Rua das Oficinas, 10",
  phone: "(92) 3333-4444",
  notifyPhone: "5592999991234",
  openingHours: { 1: weekday, 2: weekday, 3: weekday, 4: weekday, 5: weekday, 6: [{ open: "08:00", close: "12:00" }] },
  services: ["Troca de óleo", "Freios"],
  paymentMethods: ["Pix", "Cartão"],
  notes: "Estacionamento próprio",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const manaus = "America/Manaus"; // UTC-4 all year

test("accepts a profile, keeps the hours sorted and gives the notice number a country code", () => {
  const input = parseBusinessProfileInput({
    address: "  Rua A, 1 ", phone: "(92) 3333-4444", notifyPhone: "(92) 99999-1234",
    openingHours: { 1: [{ open: "14:00", close: "18:00" }, { open: "08:00", close: "12:00" }], 0: [] },
    services: ["Freios", " ", "Troca de óleo"], paymentMethods: ["Pix"], notes: "Aceitamos agendamento",
  });
  assert.equal(input.address, "Rua A, 1");
  assert.equal(input.notifyPhone, "5592999991234");
  assert.deepEqual(input.openingHours, { 1: [{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }] });
  assert.deepEqual(input.services, ["Freios", "Troca de óleo"]);
});

test("an empty profile is valid and has no schedule", () => {
  const input = parseBusinessProfileInput({});
  assert.deepEqual(input, { openingHours: {}, services: [], paymentMethods: [] });
});

for (const [name, value] of [
  ["a closing time before the opening", { openingHours: { 1: [{ open: "18:00", close: "08:00" }] } }],
  ["a time without the 24-hour format", { openingHours: { 1: [{ open: "8:00", close: "18:00" }] } }],
  ["a weekday outside 0-6", { openingHours: { 7: [{ open: "08:00", close: "18:00" }] } }],
  ["too many intervals in one day", { openingHours: { 1: Array.from({ length: 5 }, () => ({ open: "08:00", close: "09:00" })) } }],
  ["a price in a service", { services: ["Troca de óleo R$ 120"] }],
  ["a price in the notes", { notes: "Revisão por 150,00" }],
  ["a notice number without area code", { notifyPhone: "3333-4444" }],
  ["a list that is too long", { services: Array.from({ length: 51 }, (_, index) => `Serviço ${index}`) }],
  ["a body that is not an object", "texto"],
] as const) {
  test(`rejects ${name}`, () => {
    assert.throws(() => parseBusinessProfileInput(value), BusinessProfileError);
  });
}

test("facts carry what the customer may be told and never the private notice number or a price", () => {
  const facts = buildBusinessFacts(profile);
  assert.deepEqual(facts.openingHours, {
    domingo: "fechado", "segunda-feira": "08:00-18:00", "terça-feira": "08:00-18:00", "quarta-feira": "08:00-18:00",
    "quinta-feira": "08:00-18:00", "sexta-feira": "08:00-18:00", sábado: "08:00-12:00",
  });
  const json = JSON.stringify(facts);
  assert.equal(json.includes("5592999991234"), false);
  assert.equal(json.includes("notifyPhone"), false);
  assert.equal(json.includes("businessId"), false);
  assert.equal(/R\$|reais/.test(json), false);
  assert.equal(facts.phone, "(92) 3333-4444");
});

test("facts omit the schedule when no hours are registered, so the model cannot guess it", () => {
  assert.equal(Object.hasOwn(buildBusinessFacts({ ...profile, openingHours: {} }), "openingHours"), false);
});

test("isOpenAt reads the weekday and time in the workshop timezone", () => {
  assert.equal(isOpenAt(profile, "2026-11-07T15:00:00Z", manaus), true); // Saturday 11:00
  assert.equal(isOpenAt(profile, "2026-11-07T16:00:00Z", manaus), false); // Saturday 12:00, closing is exclusive
  assert.equal(isOpenAt(profile, "2026-11-07T17:00:00Z", manaus), false); // Saturday 13:00
  assert.equal(isOpenAt(profile, "2026-11-08T15:00:00Z", manaus), false); // Sunday
  assert.equal(isOpenAt(profile, "2026-11-09T12:00:00Z", manaus), true); // Monday 08:00, opening is inclusive
  assert.equal(isOpenAt(profile, "2026-11-09T11:59:00Z", manaus), false);
  // The same instant is another weekday time elsewhere: Monday 07:00 in Manaus is 11:00 in UTC.
  assert.equal(isOpenAt(profile, "2026-11-09T11:00:00Z", "UTC"), true);
  assert.equal(isOpenAt(profile, "2026-11-09T11:00:00Z", manaus), false);
});

test("nextOpening finds today, tomorrow or the next week", () => {
  assert.deepEqual(nextOpening(profile, "2026-11-09T11:00:00Z", manaus), { daysAhead: 0, weekday: 1, time: "08:00" }); // Monday 07:00
  assert.deepEqual(nextOpening(profile, "2026-11-07T17:00:00Z", manaus), { daysAhead: 2, weekday: 1, time: "08:00" }); // Saturday 13:00
  assert.deepEqual(nextOpening(profile, "2026-11-09T22:30:00Z", manaus), { daysAhead: 1, weekday: 2, time: "08:00" }); // Monday 18:30
  const onlyMonday: BusinessProfile = { ...profile, openingHours: { 1: weekday } };
  assert.deepEqual(nextOpening(onlyMonday, "2026-11-09T22:30:00Z", manaus), { daysAhead: 7, weekday: 1, time: "08:00" });
  assert.equal(nextOpening({ ...profile, openingHours: {} }, "2026-11-09T22:30:00Z", manaus), undefined);
});

test("the closed notice names when the workshop opens and stays silent while open or without a schedule", () => {
  assert.equal(closedNotice(profile, "2026-11-09T11:00:00Z", manaus), "Estamos fora do horário de atendimento. Voltamos hoje às 08:00.");
  assert.equal(closedNotice(profile, "2026-11-09T22:30:00Z", manaus), "Estamos fora do horário de atendimento. Voltamos amanhã às 08:00.");
  assert.equal(closedNotice(profile, "2026-11-07T17:00:00Z", manaus), "Estamos fora do horário de atendimento. Voltamos na segunda-feira às 08:00.");
  assert.equal(closedNotice(profile, "2026-11-07T15:00:00Z", manaus), undefined);
  assert.equal(closedNotice({ ...profile, openingHours: {} }, "2026-11-07T17:00:00Z", manaus), undefined);
});

test("the local date and time is written in the workshop timezone", () => {
  assert.equal(formatLocalDateTime("2026-11-07T17:00:00Z", manaus), "2026-11-07 13:00 (sábado, America/Manaus)");
});
