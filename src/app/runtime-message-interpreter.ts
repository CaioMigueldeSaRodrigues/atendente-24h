import type { MessageInterpreter } from "../core/message-interpreter.js";
import { Gate3FakeMessageInterpreter } from "../integrations/test-only/gate3-fake-message-interpreter.js";
import { createMessageInterpreter } from "../integrations/llm/create-message-interpreter.js";
import { readLlmEnvironment } from "../integrations/llm/llm-environment.js";

export function isGate3FakeInterpreterEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment.GATE3_FAKE_INTERPRETER?.trim() === "true";
}

export function createRuntimeMessageInterpreter(environment: NodeJS.ProcessEnv): MessageInterpreter {
  if (isGate3FakeInterpreterEnabled(environment)) {
    return new Gate3FakeMessageInterpreter();
  }
  return createMessageInterpreter(readLlmEnvironment(environment));
}
