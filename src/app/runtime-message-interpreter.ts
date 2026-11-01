import type { MessageInterpreter } from "../core/message-interpreter.js";
import { Gate3FakeMessageInterpreter } from "../integrations/test-only/gate3-fake-message-interpreter.js";
import { createMessageInterpreter } from "../integrations/llm/create-message-interpreter.js";
import { isProduction, readLlmEnvironment } from "../integrations/llm/llm-environment.js";
import type { AiUsageRecorder } from "../core/ai-usage.js";

export function isGate3FakeInterpreterEnabled(environment: NodeJS.ProcessEnv): boolean {
  const enabled = environment.GATE3_FAKE_INTERPRETER?.trim() === "true";
  if (enabled && isProduction(environment)) throw new Error("GATE3_FAKE_INTERPRETER is not allowed with NODE_ENV=production");
  return enabled;
}

export function createRuntimeMessageInterpreter(
  environment: NodeJS.ProcessEnv,
  usageRecorder?: AiUsageRecorder,
  onUsageRecordingFailure?: (error: unknown) => void,
): MessageInterpreter {
  if (isGate3FakeInterpreterEnabled(environment)) {
    return new Gate3FakeMessageInterpreter();
  }
  return createMessageInterpreter(readLlmEnvironment(environment), usageRecorder, onUsageRecordingFailure);
}
