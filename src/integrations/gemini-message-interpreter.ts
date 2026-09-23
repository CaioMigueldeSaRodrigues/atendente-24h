import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { MessageInterpreter, MessageInterpreterInput } from "../core/message-interpreter.js";
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

    const interaction = await this.client.interactions.create({
      model: this.model,
      system_instruction: INTERPRETER_INSTRUCTIONS,
      input: JSON.stringify(context),
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: interpretationJsonSchema,
      },
    });

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
}
