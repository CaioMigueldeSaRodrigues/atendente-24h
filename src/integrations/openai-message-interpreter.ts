import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { MessageInterpreter, MessageInterpreterInput } from "../core/message-interpreter.js";
import { modelAIInterpretationSchema, parseAIInterpretation } from "../core/ai-interpretation-schema.js";

const INTERPRETER_INSTRUCTIONS = `Você é somente uma camada de interpretação de linguagem para um estabelecimento automotivo.

Analise o contexto fornecido para identificar a intenção, extrair somente dados declarados pelo cliente, identificar o produto, serviço ou combinação de produto e serviço solicitado, identificar relatos de sintomas, apontar dados ausentes, sugerir a próxima ação, indicar se é necessária uma pessoa e propor uma resposta natural.

Não confirme diagnósticos, não invente preços ou disponibilidade, não confirme agendamentos, não afirme que uma ação externa ocorreu e não crie fatos que não estejam presentes no histórico. Quando um campo nullable não for conhecido, retorne null.

O sistema determinístico é a autoridade para regras e ações.`;

export class OpenAIMessageInterpreter implements MessageInterpreter {
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

    const response = await this.client.responses.parse({
      model: this.model,
      instructions: INTERPRETER_INSTRUCTIONS,
      input: JSON.stringify(context),
      text: {
        format: zodTextFormat(
          modelAIInterpretationSchema,
          "automotive_interpretation",
        ),
      },
    });

    const outputParsed: unknown = response.output_parsed;
    if (outputParsed === null || outputParsed === undefined) {
      throw new Error("AI response could not be parsed");
    }

    return parseAIInterpretation(outputParsed);
  }
}
