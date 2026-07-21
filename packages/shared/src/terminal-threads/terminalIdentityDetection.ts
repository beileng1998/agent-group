import type { TerminalCliKind } from "./terminalIdentity";

const CODEX_COMMAND_NAMES = new Set(["codex", "codex-cli"]);
const CLAUDE_COMMAND_NAMES = new Set(["claude", "claude-code", "claude_code"]);
const ANTIGRAVITY_COMMAND_NAMES = new Set(["agy", "antigravity", "antigravity-cli"]);
const OUTPUT_CODEX_TEXT_PATTERNS = [/\bopenai codex\b(?:\s*\(|\s+v)/i, /\bcodex cli\b/i];
const OUTPUT_CLAUDE_TEXT_PATTERNS = [/\bclaude code\b(?:\s+v\d|\s*$)/i];
const OUTPUT_ANTIGRAVITY_TEXT_PATTERNS = [/\bantigravity cli\b/i];
const TITLE_CODEX_TEXT_PATTERNS = [/\bopenai codex\b/i, /\bcodex cli\b/i];
const TITLE_CLAUDE_TEXT_PATTERNS = [/\bclaude code\b/i];
const TITLE_ANTIGRAVITY_TEXT_PATTERNS = [/\bantigravity(?: cli)?\b/i, /^agy(?: cli)?$/i];
const PROCESS_CODEX_TEXT_PATTERNS = [/@openai\/codex/i];
const PROCESS_CLAUDE_TEXT_PATTERNS = [/@anthropic-ai\/claude-code/i, /anthropic\/claude-code/i];
const PROCESS_ANTIGRAVITY_TEXT_PATTERNS = [/google-antigravity\/antigravity-cli/i];

export function normalizeTextForIdentityDetection(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, " ")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, " ")
    .replace(/\u001b[P^_].*?(?:\u001b\\|\u0007|\u009c)/g, " ")
    .replace(/\u001b[@-_]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCommandToken(token: string): string {
  const normalizedPath = token.replaceAll("\\", "/");
  const segments = normalizedPath.split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment) {
      return segment.toLowerCase();
    }
  }
  return normalizedPath.toLowerCase();
}

function stripScriptExtension(token: string): string {
  return token.replace(/\.(?:cjs|cts|js|jsx|mjs|mts|py|ts|tsx)$/i, "");
}

function deriveCliKindFromNormalizedToken(token: string): TerminalCliKind | null {
  const normalizedToken = stripScriptExtension(token.trim().toLowerCase());
  if (normalizedToken.length === 0) {
    return null;
  }
  if (CODEX_COMMAND_NAMES.has(normalizedToken) || normalizedToken === "@openai/codex") {
    return "codex";
  }
  if (
    CLAUDE_COMMAND_NAMES.has(normalizedToken) ||
    normalizedToken === "@anthropic-ai/claude-code"
  ) {
    return "claude";
  }
  if (ANTIGRAVITY_COMMAND_NAMES.has(normalizedToken)) {
    return "antigravity";
  }
  return null;
}

export function deriveCliKindFromTokenList(tokens: string[]): TerminalCliKind | null {
  for (const token of tokens) {
    const cliKind = deriveCliKindFromNormalizedToken(normalizeCommandToken(token));
    if (cliKind) {
      return cliKind;
    }
  }
  return null;
}

function textMatchesCliPatterns(
  text: string,
  patterns: ReadonlyArray<RegExp>,
  cliKind: TerminalCliKind,
): TerminalCliKind | null {
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return cliKind;
    }
  }
  return null;
}

export function deriveCliKindFromOutputText(
  text: string | null | undefined,
): TerminalCliKind | null {
  const normalizedText = text?.trim();
  if (!normalizedText) {
    return null;
  }
  return (
    textMatchesCliPatterns(normalizedText, OUTPUT_CODEX_TEXT_PATTERNS, "codex") ??
    textMatchesCliPatterns(normalizedText, OUTPUT_CLAUDE_TEXT_PATTERNS, "claude") ??
    textMatchesCliPatterns(normalizedText, OUTPUT_ANTIGRAVITY_TEXT_PATTERNS, "antigravity")
  );
}

export function deriveCliKindFromProcessText(
  text: string | null | undefined,
): TerminalCliKind | null {
  const normalizedText = text?.trim();
  if (!normalizedText) {
    return null;
  }
  return (
    textMatchesCliPatterns(normalizedText, PROCESS_CODEX_TEXT_PATTERNS, "codex") ??
    textMatchesCliPatterns(normalizedText, PROCESS_CLAUDE_TEXT_PATTERNS, "claude") ??
    textMatchesCliPatterns(normalizedText, PROCESS_ANTIGRAVITY_TEXT_PATTERNS, "antigravity")
  );
}

export function inferCliKindFromTitle(title: string | null | undefined): TerminalCliKind | null {
  const normalizedTitle = title?.trim().toLowerCase();
  if (!normalizedTitle) {
    return null;
  }
  if (/^codex(?: cli)?(?: \d+)?$/.test(normalizedTitle)) {
    return "codex";
  }
  if (/^claude(?: code)?(?: \d+)?$/.test(normalizedTitle) || normalizedTitle === "claude-code") {
    return "claude";
  }
  if (/^(?:antigravity(?: cli)?|agy(?: cli)?)(?: \d+)?$/.test(normalizedTitle)) {
    return "antigravity";
  }
  return (
    textMatchesCliPatterns(normalizedTitle, TITLE_CODEX_TEXT_PATTERNS, "codex") ??
    textMatchesCliPatterns(normalizedTitle, TITLE_CLAUDE_TEXT_PATTERNS, "claude") ??
    textMatchesCliPatterns(normalizedTitle, TITLE_ANTIGRAVITY_TEXT_PATTERNS, "antigravity")
  );
}
