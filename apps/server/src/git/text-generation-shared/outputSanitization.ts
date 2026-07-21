export function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

export function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

export function sanitizeDiffSummary(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  return [
    "## Summary",
    "- Update the current diff.",
    "",
    "## Files Changed",
    "- Not available.",
  ].join("\n");
}

export function sanitizeThreadRecap(raw: string, previousRecap?: string): string {
  const strippedPrefix = raw
    .trim()
    .replace(/^recap\s*:\s*/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const fallback = previousRecap?.trim().replace(/\s+/gu, " ") ?? "";
  const candidate = strippedPrefix.length > 0 ? strippedPrefix : fallback;

  if (candidate.length === 0) {
    return "No meaningful recap yet.";
  }
  if (candidate.length <= 240) {
    return candidate;
  }

  const clipped = candidate.slice(0, 237).trimEnd();
  return `${clipped}...`;
}
