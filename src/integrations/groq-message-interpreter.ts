import OpenAI from "openai";
import { z } from "zod";
import type { MessageInterpreter, MessageInterpreterInput } from "../core/message-interpreter.js";
import {
  modelAIInterpretationSchema,
  parseAIInterpretation,
} from "../core/ai-interpretation-schema.js";

const INTERPRETER_INSTRUCTIONS = `Você é somente uma camada de interpretação de linguagem para um estabelecimento automotivo. O domínio determinístico continua sendo a autoridade para regras e ações.

Analise o contexto para identificar Intent; extrair dados declarados do cliente e do veículo; identificar o produto, serviço ou produto e serviço solicitado; identificar symptomDescription; preencher missingData; sugerir suggestedNextAction; indicar requiresHuman; escolher handoffReason quando aplicável; propor proposedResponse; e fornecer confidence quando apropriado.

DADOS EXTRAÍDOS
extractedCustomerData e extractedVehicleData devem conter somente informações explicitamente declaradas pelo cliente no conteúdo atual ou no histórico. Não infira dados usando conhecimento geral. Por exemplo, se o cliente disser “Tenho um Corolla 2020”, pode preencher model = “Corolla” e year = 2020, mas não brand = “Toyota”, a menos que Toyota tenha sido explicitamente mencionada.

DADOS FALTANTES DO CLIENTE
Quando faltarem dados que o próprio cliente pode fornecer, como placa, modelo, ano, versão, quilometragem, telefone ou descrição complementar, isso não exige atendimento humano por si só. Nesse caso, use requiresHuman = false, handoffReason = null e suggestedNextAction.type = “REQUEST_INFORMATION”. proposedResponse pode solicitar naturalmente os dados faltantes.

UNKNOWN_INFORMATION
Não use HandoffReason.UNKNOWN_INFORMATION apenas porque falta um dado do cliente ou do veículo. UNKNOWN_INFORMATION é reservado para quando uma informação necessária não pode ser obtida do cliente e depende de conhecimento, decisão, política ou informação interna do estabelecimento.

ATENDIMENTO HUMANO
requiresHuman deve ser true somente quando uma pessoa realmente precisar assumir ou revisar o atendimento, como quando o cliente pedir explicitamente uma pessoa, houver diagnóstico técnico que a IA não possa confirmar, preocupação de segurança, negociação ou desconto, reclamação ou garantia que exija revisão, informação comercial ou interna indisponível, conflito de informações ou baixa confiança relevante. Não encaminhe para uma pessoa somente porque a conversa está incompleta.

ORÇAMENTO
Para QUOTE_REQUEST com dados insuficientes, mantenha intent = QUOTE_REQUEST, preencha missingData e use suggestedNextAction.type = “REQUEST_INFORMATION”. Mantenha requiresHuman = false enquanto os dados puderem ser solicitados ao cliente. Nunca invente preço ou disponibilidade.

Não confirme diagnósticos ou agendamentos, não afirme que uma ação externa ocorreu e não invente fatos ausentes do histórico. Quando um campo nullable for desconhecido, retorne null.`;

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
