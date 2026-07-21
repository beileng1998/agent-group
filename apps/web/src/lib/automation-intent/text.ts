export function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeSearchText(value: string): string {
  return normalizeInlineText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function removeMatchedText(value: string, match: RegExpExecArray): string {
  return normalizeInlineText(
    `${value.slice(0, match.index)} ${value.slice(match.index + match[0].length)}`,
  )
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/^(?:and|then|to|e|poi|che|di|per)\s+/i, "");
}

export function wordCount(value: string): number {
  return normalizeInlineText(value).split(/\s+/).filter(Boolean).length;
}
