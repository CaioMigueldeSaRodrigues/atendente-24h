import assert from "node:assert/strict";
import test from "node:test";
import { getQuoteIntakeMissingData } from "../../src/core/quote-intake-policy.js";

test("an absent commercial object requires only a service, product or symptom", () => {
  assert.deepEqual(getQuoteIntakeMissingData({}), ["requestedItem"]);
  assert.deepEqual(getQuoteIntakeMissingData({ requestedItem: "  ", symptomDescription: "\t" }), ["requestedItem"]);
});

for (const requestedItem of ["Troca de óleo", "Pastilhas de freio", "Película térmica"]) {
  test(`accepts ${requestedItem} without customer or vehicle registration data`, () => {
    assert.deepEqual(getQuoteIntakeMissingData({ requestedItem }), []);
  });
}

test("a symptom is sufficient to register a request without inventing a diagnosis", () => {
  assert.deepEqual(getQuoteIntakeMissingData({ symptomDescription: "Barulho metálico ao frear" }), []);
});
