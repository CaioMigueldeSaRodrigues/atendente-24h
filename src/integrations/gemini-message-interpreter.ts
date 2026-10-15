import { GoogleGenAI } from "@google/genai";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { MessageInterpreter, MessageInterpreterInput } from "../core/message-interpreter.js";
import type { AiUsageRecorder, AiUsageSnapshot } from "../core/ai-usage.js";
import {
  modelAIInterpretationSchema,
  parseAIInterpretation,
} from "../core/ai-interpretation-schema.js";

const INTERPRETER_INSTRUCTIONS = `Você é somente uma camada de interpretação de linguagem para um estabelecimento automotivo.

Analise o contexto fornecido para identificar a intenção, extrair somente dados declarados pelo cliente e pelo veículo, identificar o produto, serviço ou combinação de produto e serviço solicitado, identificar symptomDescription, apontar missingData, sugerir suggestedNextAction, indicar requiresHuman, escolher handoffReason quando aplicável, propor proposedResponse e fornecer confidence quando apropriado.

Não confirme diagnósticos, não invente preços, disponibilidade ou fatos ausentes do histórico, não confirme agendamentos e não afirme que uma ação externa ocorreu. Quando um campo nullable não for conhecido, retorne null.

O domínio determinístico é a autoridade para regras e ações.`;

const interpretationJsonSchema = z.toJSONSchema(modelAIInterpretationSchema);

export class GeminiMessageInterpreter implements MessageInterpreter {
  constructor(
    private readonly client: GoogleGenAI,
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
    let interaction: Awaited<ReturnType<GoogleGenAI["interactions"]["create"]>>;
    try {
      interaction = await this.client.interactions.create({
        model: this.model,
        system_instruction: INTERPRETER_INSTRUCTIONS,
        input: JSON.stringify(context),
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: interpretationJsonSchema,
        },
      });
    } catch (error) {
      await this.recordUsage(input.businessId, input.conversationId, {
        provider: this.options.provider ?? "gemini",
        model: this.model,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalTimeMs: elapsedMilliseconds(startedAt),
        status: "FAILED",
        errorCode: "AI_REQUEST_FAILED",
      });
      throw error;
    }

    await this.recordUsage(input.businessId, input.conversationId, readUsage(interaction, this.options.provider ?? "gemini", this.model, elapsedMilliseconds(startedAt)));

    const outputText = interaction.output_text;
    if (!outputText?.trim()) {
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
      this.options.onUsageRecordingFailure?.(error);
    }
  }
}

function readUsage(interaction: unknown, provider: string, model: string, totalTimeMs: number): AiUsageSnapshot {
  const record = typeof interaction === "object" && interaction !== null ? interaction as Record<string, unknown> : {};
  const usage = typeof record.usage_metadata === "object" && record.usage_metadata !== null
    ? record.usage_metadata as Record<string, unknown>
    : {};
  const inputTokens = nonNegativeInteger(usage.prompt_token_count);
  return {
    provider,
    model,
    ...(typeof record.id === "string" ? { providerRequestId: record.id } : {}),
    inputTokens,
    cachedInputTokens: Math.min(nonNegativeInteger(usage.cached_content_token_count), inputTokens),
    outputTokens: nonNegativeInteger(usage.candidates_token_count),
    totalTokens: nonNegativeInteger(usage.total_token_count),
    totalTimeMs,
  };
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
