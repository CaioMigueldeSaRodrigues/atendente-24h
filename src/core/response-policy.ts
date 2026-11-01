import { Intent } from "./domain/enums.js";
import type { NextAction } from "./domain/types.js";
import type { BusinessFacts } from "./business-profile.js";

export const MAX_REPLY_CHARS = 1000;
export const HANDOFF_REPLY = "Vou encaminhar sua solicitação para a equipe responsável.";
export const UNSAFE_REPLY_FALLBACK = "Recebi sua mensagem. A equipe vai confirmar essa informação e retornar para você.";
export const LLM_FAILURE_REPLY = "Não consegui processar sua mensagem agora. Vou encaminhar para a equipe responsável.";
export const LLM_LIMITED_REPLY = "No momento não consigo responder automaticamente. Tente novamente mais tarde.";
export const UNSUPPORTED_MESSAGE_REPLY = "Por enquanto só consigo ler mensagens de texto. Pode escrever o que você precisa?";
export const QUOTE_LOCKED_REPLY = "Seu orçamento já está com a equipe. Alterações no pedido serão avaliadas por ela.";

const DURATION = "(?:\\d+|uma?|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez)\\s*(?:min|minutos?|h|horas?|dias?|semanas?|m[êe]s(?:es)?)\\b";
const DELIVERY_VERB = "\\b(?:pront[oa]s?\\b|entreg|termin|conclu|fica\\b|ficam\\b|ficar[áa]|sai\\b|sair[áa]|resolv|consert)";

// Time words alone are not promises: "há dois dias", "hoje ou amanhã?" and "das 8 às 18 horas" must pass.
const COMMERCIAL_PROMISE_PATTERNS: readonly RegExp[] = [
  /\bestoques?\b|\bvagas?\b|\bencaix\w*|\bgarant\w*|\bpode\s+vir\b/i, // estoque, vaga, encaixe e garantia
  /R\s*\$|\breais\b/i, // preço
  /\b\d{1,3}(?:\.\d{3})*,\d{2}\b/, // preço
  /\b(?:pre[çc]o|valor)\s+(?:[ée]\s+|fica\s+|sai\s+)?(?:de\s+|por\s+|em\s+)?\d/i, // preço
  /\bcusta(?:m|r[áa])?\s+(?:apenas\s+|s[óo]\s+)?\d|\bsai\s+(?:por|a)\s+\d|\bfica\s+(?:em|por)\s+\d/i, // preço
  /\d\s*%|\bpor\s?cento\b/i, // percentual
  /(?<!\bn[ãa]o\b[^.!?,;]{0,30})\bdescontos?\b|\bpromo[çc]|\bgr[áa]tis|\bde gra[çc]a\b|\bcortesia\b/i, // desconto
  /\bprazos?\b|\bhoje mesmo\b|\bno mesmo dia\b|\b(?:semana|m[êe]s) que vem\b|\bpr[óo]xim[ao] (?:semana|m[êe]s)\b/i, // prazo
  /(?<!\b(?:h[áa]|faz)\s+)\bmeia[- ]hora\b/i, // prazo
  new RegExp(`\\b(?:em|dentro de|daqui a|coisa de|leva\\w*|demora\\w*)\\s+(?:cerca de\\s+|uns\\s+|umas\\s+)?${DURATION}`, "i"), // prazo
  new RegExp(`${DELIVERY_VERB}[^.!?]{0,40}(?:\\bhoje\\b|amanh[ãa])|amanh[ãa][^.!?]{0,40}${DELIVERY_VERB}`, "i"), // prazo
  /https?:\/\/|\bwww\./i, // URL
  /\b[A-Za-z0-9-]+\.(?:com|net|org|br|io|me|ly)\b/, // URL, TLD in lower case so "Entendi.Me diga" passes
];

// Deadlines that are harmless inside a sentence that states opening hours: "abrimos no sábado", "atendemos até 18 horas".
const HOURS_ONLY_PATTERNS: readonly RegExp[] = [
  /\b(?:at[ée]|para|pra|ainda)\s+(?:hoje\b|amanh[ãa])/i,
  /\b(?:na|no|nesta|neste|at[ée]|para|pra)\s+(?:pr[óo]xim[ao]\s+)?(?:segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b/i,
  new RegExp(`\\bat[ée]\\s+(?:cerca de\\s+|uns\\s+|umas\\s+)?${DURATION}`, "i"),
];
const HOURS_WORD = /\b(?:funcion\w*|atend\w*|abr(?:imos|e|em|ir)|abert[oa]s?|fech\w*|expediente|hor[áa]rios?)\b/i;
const CLOCK_TIME = /\b\d{1,2}(?:\s?h(?:s|oras?)?\b|:\d{2}\b)/i;
// "Podemos atender na sexta às 15h" is a booking promise, not opening hours.
const SCHEDULING_WORD = /\b(?:pod\w+|posso|consigo|vamos|vou|teremos|encaix\w*|agend\w*|marc\w*|reserv\w*)\b/i;
const HOURS_RANGE = /\bdas\s+\d{1,2}(?::\d{2}|\s?h\w*)?\s+(?:[àa]s|at[ée])\s+\d{1,2}(?::\d{2}|\s?h\w*)?/i;
// ponytail: a closing time alone is told from a deadline by the hour (10 to 23), so "até 2 horas" stays blocked.
const CLOSING_TIME_ALONE = /^\W*at[ée]\s+(?:[àa]s\s+)?(?:1\d|2[0-3])(?::\d{2}|\s?h(?:oras?)?)\W*$/i;
const isOpeningHoursSentence = (sentence: string): boolean =>
  ((HOURS_WORD.test(sentence) && CLOCK_TIME.test(sentence)) || HOURS_RANGE.test(sentence) || CLOSING_TIME_ALONE.test(sentence)) && !SCHEDULING_WORD.test(sentence);

// Only the times themselves are excused in an hours sentence: "Abrimos às 8h e sai uns 300" still has a number to answer for.
const HOURS_TEXT = new RegExp(`${HOURS_RANGE.source}|${CLOCK_TIME.source}`, "gi");
// "Faz 3 meses que o carro está assim?" is the customer's past, not an offer.
const PAST_TIME = /\b(?:h[áa]|faz)\s+(?:cerca de\s+|uns\s+|umas\s+|mais de\s+)?\d+\s*(?:min|minutos?|h|horas?|dias?|semanas?|m[êe]s(?:es)?|anos?)\b/gi;
// Digits together with their separators, so a phone is read whole: "(92) 3333-4444".
const NUMBER_RUN = /\d(?:[\s().-]*\d)*/g;

export function resolveSafeReply(input: {
  intent: Intent;
  proposedResponse: string;
  requiresHuman: boolean;
  suggestedNextAction: NextAction;
  missingData: readonly string[];
  businessFacts?: BusinessFacts;
}): { reply: string; blocked: boolean } {
  if (input.requiresHuman) {
    return { reply: HANDOFF_REPLY, blocked: false };
  }

  if (
    input.intent === Intent.QUOTE_REQUEST &&
    input.suggestedNextAction.type === "REQUEST_INFORMATION" &&
    input.missingData.includes("requestedItem")
  ) {
    return { reply: "Qual serviço ou produto você deseja orçar? Pode também descrever o sintoma.", blocked: false };
  }

  if (input.intent === Intent.QUOTE_REQUEST) {
    return { reply: "Solicitação de orçamento registrada. A equipe precisa confirmar o valor.", blocked: false };
  }

  if (input.intent === Intent.APPOINTMENT_REQUEST) {
    return { reply: "Solicitação de agendamento registrada. O horário ainda precisa ser confirmado pela equipe.", blocked: false };
  }

  return isSafeFreeReply(input.proposedResponse, factNumbers(input.businessFacts))
    ? { reply: input.proposedResponse, blocked: false }
    : { reply: UNSAFE_REPLY_FALLBACK, blocked: true };
}

function isSafeFreeReply(reply: string, knownNumbers: ReadonlySet<string>): boolean {
  return reply.length <= MAX_REPLY_CHARS &&
    !COMMERCIAL_PROMISE_PATTERNS.some((pattern) => pattern.test(reply)) &&
    reply.split(/(?<=[.!?])\s+|\n+/).every((sentence) => isOpeningHoursSentence(sentence)
      ? hasOnlyKnownNumbers(sentence.replace(HOURS_TEXT, " "), knownNumbers)
      : !HOURS_ONLY_PATTERNS.some((pattern) => pattern.test(sentence)) && hasOnlyKnownNumbers(sentence, knownNumbers));
}

function hasOnlyKnownNumbers(sentence: string, knownNumbers: ReadonlySet<string>): boolean {
  return (sentence.replace(PAST_TIME, " ").match(NUMBER_RUN) ?? []).every((run) =>
    knownNumbers.has(canonicalNumber(run)) || run.match(/\d+/g)!.every((part) => knownNumbers.has(canonicalNumber(part))));
}

// Every number the workshop registered, each one alone and each field's digits whole, so "Rua A, 300" and any spelling of the phone are found.
function factNumbers(facts: BusinessFacts | undefined): ReadonlySet<string> {
  if (facts === undefined) return new Set();
  const fields = [facts.address, facts.phone, facts.notes, ...facts.services, ...facts.paymentMethods, ...Object.values(facts.openingHours ?? {})];
  return new Set(fields.flatMap((field) => [field ?? "", ...(field?.match(/\d+/g) ?? [])]).filter((value) => /\d/.test(value)).map(canonicalNumber));
}

function canonicalNumber(value: string): string {
  return value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}
