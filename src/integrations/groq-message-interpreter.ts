import OpenAI from "openai";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { AiUsageRecorder, AiUsageSnapshot } from "../core/ai-usage.js";
import type { MessageInterpreter, MessageInterpreterInput } from "../core/message-interpreter.js";
import { modelAIInterpretationSchema, parseAIInterpretation } from "../core/ai-interpretation-schema.js";
import { INTERPRETER_INSTRUCTIONS } from "./openai-message-interpreter.js";

const { $schema: _schemaMetadata, ...groqInterpretationSchema } = z.toJSONSchema(
  modelAIInterpretationSchema,
);

export class GroqMessageInterpreter implements MessageInterpreter {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly options: {
      provider?: string;
      usageRecorder?: AiUsageRecorder;
      onUsageRecordingFailure?: (error: unknown) => void;
    } = {},
  ) {}

  async interpret(input: MessageInterpreterInput) {
    const context = {
      businessId: input.businessId,
      conversationId: input.conversationId,
      content: input.content,
      history: input.history.map(({ senderType, content }) => ({
        senderType,
        content,
      })),
    };

    const startedAt = performance.now();
    let response: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptStartedAt = performance.now();
      try {
        response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: INTERPRETER_INSTRUCTIONS },
            { role: "user", content: JSON.stringify(context) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "automotive_interpretation",
              strict: true,
              schema: groqInterpretationSchema,
            },
          },
        });
        break;
      } catch (error) {
        await this.recordUsage(input.businessId, input.conversationId, {
          provider: this.options.provider ?? "groq",
          model: this.model,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          totalTimeMs: elapsedMilliseconds(attemptStartedAt),
          status: "FAILED",
          errorCode: isJsonValidateFailed(error) ? "JSON_VALIDATE_FAILED" : "AI_REQUEST_FAILED",
        });
        if (!isJsonValidateFailed(error) || attempt === 1) throw error;
      }
    }

    if (response === undefined) throw new Error("AI response could not be parsed");

    await this.recordUsage(
      input.businessId,
      input.conversationId,
      readUsage(response, this.options.provider ?? "groq", this.model, elapsedMilliseconds(startedAt)),
    );

    const outputText = readOutputText(response);
    if (outputText === undefined || outputText.trim().length === 0) {
      throw new Error("AI response could not be parsed");
    }

    let output: unknown;
    try {
      output = JSON.parse(outputText);
    } catch {
      throw new Error("AI response could not be parsed");
    }
    return parseAIInterpretation(output);
  }

  private async recordUsage(businessId: string, conversationId: string, usage: AiUsageSnapshot): Promise<void> {
    if (this.options.usageRecorder === undefined) return;
    try {
      await this.options.usageRecorder.record({ businessId, conversationId, usage });
    } catch (error) {
      try {
        this.options.onUsageRecordingFailure?.(error);
      } catch {
        // Telemetry observers must not invalidate a valid provider response.
      }
    }
  }
}

function readOutputText(response: unknown): string | undefined {
  const record = asRecord(response);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  return typeof message?.content === "string" ? message.content : undefined;
}

function readUsage(response: unknown, provider: string, model: string, totalTimeMs: number): AiUsageSnapshot {
  const record = asRecord(response);
  const usage = asRecord(record?.usage);
  const metadata = asRecord(record?.metadata);
  const promptDetails = asRecord(usage?.prompt_tokens_details) ?? asRecord(usage?.input_tokens_details);
  const inputTokens = nonNegativeInteger(usage?.prompt_tokens ?? usage?.input_tokens);
  const xGroq = asRecord(record?.x_groq);
  return {
    provider,
    model,
    ...(typeof xGroq?.id === "string"
      ? { providerRequestId: xGroq.id }
      : typeof record?.id === "string" ? { providerRequestId: record.id } : {}),
    inputTokens,
    cachedInputTokens: Math.min(nonNegativeInteger(promptDetails?.cached_tokens), inputTokens),
    outputTokens: nonNegativeInteger(usage?.completion_tokens ?? usage?.output_tokens),
    totalTokens: nonNegativeInteger(usage?.total_tokens),
    ...optionalMillisecondsFromRecords("queueTimeMs", [usage, metadata], "queue_time"),
    ...optionalMillisecondsFromRecords("promptTimeMs", [usage, metadata], "prompt_time"),
    ...optionalMillisecondsFromRecords("completionTimeMs", [usage, metadata], "completion_time"),
    totalTimeMs: optionalNumberFromRecords([usage, metadata], "total_time", totalTimeMs),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function isJsonValidateFailed(error: unknown): boolean {
  const record = asRecord(error);
  return record?.code === "json_validate_failed";
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function optionalMillisecondsFromRecords(key: string, records: Array<Record<string, unknown> | undefined>, sourceKey: string): Record<string, number> {
  for (const record of records) {
    const value = record?.[sourceKey];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return { [key]: Math.round(value * 1000) };
    }
  }
  return {};
}

function optionalNumberFromRecords(records: Array<Record<string, unknown> | undefined>, sourceKey: string, fallback: number): number {
  for (const record of records) {
    const value = record?.[sourceKey];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 1000);
  }
  return fallback;
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
