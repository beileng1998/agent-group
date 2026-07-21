// FILE: codexErrorClassification.ts
// Purpose: Centralizes Codex runtime error classification and user-facing error cleanup.
// Exports: non-fatal classification and concise adapter error messages.

const NON_FATAL_CODEX_ERROR_SNIPPETS = [
  "write_stdin failed: stdin is closed for this session",
] as const;

export function isNonFatalCodexErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return NON_FATAL_CODEX_ERROR_SNIPPETS.some((snippet) => normalized.includes(snippet));
}

export function codexUserFacingErrorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error) || cause.message.length === 0) return fallback;
  const firstLine = cause.message.trim().split("\n")[0]?.trim() ?? "";
  const withoutInlineStack = firstLine.replace(/\s+at file:\/\/.*$/s, "").trim();
  return withoutInlineStack.length > 0 ? withoutInlineStack : fallback;
}
