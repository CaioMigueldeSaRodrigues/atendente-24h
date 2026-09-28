import assert from "node:assert/strict";
import test from "node:test";
import { readEvolutionGoWebhookCredential } from "../../src/app/evolution-go-webhook-environment.js";

const businessId = "business-synthetic-1";
const fakeToken = "fake-evolution-token-for-tests-only";

test("disables Evolution Go when both environment values are absent or empty", () => {
  assert.equal(readEvolutionGoWebhookCredential({}, businessId), undefined);
  assert.equal(readEvolutionGoWebhookCredential({
    EVOLUTION_GO_INSTANCE_NAME: "  ",
    EVOLUTION_GO_INSTANCE_TOKEN: "",
  }, businessId), undefined);
});

test("builds the credential for the configured business when both values exist", () => {
  assert.deepEqual(readEvolutionGoWebhookCredential({
    EVOLUTION_GO_INSTANCE_NAME: "instance-synthetic-1",
    EVOLUTION_GO_INSTANCE_TOKEN: fakeToken,
  }, businessId), {
    instanceName: "instance-synthetic-1",
    instanceToken: fakeToken,
    businessId,
  });
});

test("trims the configured instance name and token", () => {
  assert.deepEqual(readEvolutionGoWebhookCredential({
    EVOLUTION_GO_INSTANCE_NAME: "  instance-synthetic-1  ",
    EVOLUTION_GO_INSTANCE_TOKEN: "  fake-token  ",
  }, businessId), {
    instanceName: "instance-synthetic-1",
    instanceToken: "fake-token",
    businessId,
  });
});

test("rejects a partial Evolution Go configuration without exposing the token", () => {
  for (const environment of [
    { EVOLUTION_GO_INSTANCE_NAME: "instance-synthetic-1" },
    { EVOLUTION_GO_INSTANCE_TOKEN: fakeToken },
  ]) {
    assert.throws(
      () => readEvolutionGoWebhookCredential(environment, businessId),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Evolution Go webhook configuration is incomplete");
        assert.equal(error.message.includes(fakeToken), false);
        return true;
      },
    );
  }
});
