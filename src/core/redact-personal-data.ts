const NOT_INSIDE_WORD = "(?<![\\p{L}\\p{N}_-])";
const NOT_FOLLOWED_BY_WORD = "(?![\\p{L}\\p{N}_])";

// Order matters: the more specific document formats run before the generic digit runs.
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu, "[EMAIL]"],
  [boundedDigits("\\d{2}[.\\s]?\\d{3}[.\\s]?\\d{3}[/\\s]?\\d{4}[-\\s]?\\d{2}"), "[CNPJ]"],
  [boundedDigits("\\d{3}[.\\s]?\\d{3}[.\\s]?\\d{3}[-\\s]?\\d{2}"), "[CPF]"],
  [boundedDigits("\\d(?:[ -]?\\d){12,18}"), "[CARTAO]"],
  [boundedDigits("(?:\\+?55[\\s.-]?)?\\(?[1-9]\\d\\)?[\\s.-]?(?:9\\d{4}|[2-5]\\d{3})[\\s.-]?\\d{4}"), "[TELEFONE]"],
  [boundedDigits("9\\d{4}-?\\d{4}"), "[TELEFONE]"],
  // Eight digits alone also describe part codes and year ranges, so they need a phone word nearby.
  [/(?<=\b(?:telefone|fone|tel|celular|whats\w*|zap|ligue|ligar|contato|meu n[úu]mero)\D{0,15})\d{4}-\d{4}(?![\p{L}\p{N}_])/giu, "[TELEFONE]"],
];

const MARKERS: ReadonlySet<unknown> = new Set(REDACTIONS.map(([, marker]) => marker));

function boundedDigits(pattern: string): RegExp {
  return new RegExp(`${NOT_INSIDE_WORD}(?:${pattern})${NOT_FOLLOWED_BY_WORD}`, "gu");
}

export function isRedactionMarker(value: unknown): boolean {
  return MARKERS.has(typeof value === "string" ? value.trim() : value);
}

export function redactPersonalData(text: string): string {
  return REDACTIONS.reduce((current, [pattern, marker]) => current.replace(pattern, marker), text);
}
