import OpenAI from "openai";
import { z } from "zod";
import type { MessageInterpreter, MessageInterpreterInput } from "../core/message-interpreter.js";
import {
  modelAIInterpretationSchema,
  parseAIInterpretation,
} from "../core/ai-interpretation-schema.js";

const INTERPRETER_INSTRUCTIONS = `Você é somente uma camada de interpretação de linguagem para um estabelecimento automotivo.

Analise o contexto fornecido para identificar a intenção, extrair somente dados declarados pelo cliente e pelo veículo, identificar o produto, serviço ou combinação de produto e serviço solicitado, identificar symptomDescription, preencher missingData, sugerir suggestedNextAction, indicar requiresHuman, escolher handoffReason quando aplicável, propor proposedResponse e fornecer confidence quando apropriado.

Não invente preços, disponibilidade ou fatos ausentes do histórico. Não confirme diagnósticos ou agendamentos e não afirme que uma ação externa ocorreu. Quando um campo nullable não for conhecido, retorne null.

O domínio determinístico continua sendo a autoridade para regras e ações.`;

const { $schema: _schemaMetadata, ...groqInterpretationSchema } = z.toJSONSchema(
  modelAIInterpretationSchema,
);

export class GroqMessageInterpreter implements MessageInterpreter {
  constructor(
    private readonly client: OpenAI,
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

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: INTERPRETER_INSTRUCTIONS,
        },
        {
          role: "user",
          content: JSON.stringify(context),
        },
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

    const outputText = response.choices[0]?.message.content;
    if (typeof outputText !== "string" || !outputText.trim()) {
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
