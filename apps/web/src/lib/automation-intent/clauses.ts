import type {
  ChatAutomationExecutionScope,
  ParsedExecutionScope,
  ParsedIterationLimit,
  ParsedStopClause,
} from "./types";
import { normalizeInlineText, removeMatchedText } from "./text";

export function extractExecutionScope(value: string): ParsedExecutionScope | null {
  const patterns: ReadonlyArray<{
    readonly executionScope: ChatAutomationExecutionScope;
    readonly pattern: RegExp;
  }> = [
    {
      executionScope: "worktree",
      pattern: /\b(?:in|on|with|using|su|con)\s+(?:a\s+|un\s+)?(?:new\s+|nuovo\s+)?worktree\b/i,
    },
    { executionScope: "worktree", pattern: /\b(?:new|nuovo)\s+worktree\b/i },
    {
      executionScope: "standalone",
      pattern:
        /\b(?:run|create|make|start|save|crea|fai|avvia)\s+(?:it\s+)?(?:as\s+)?(?:a\s+|un\s+)?standalone(?:\s+automation)?\b/i,
    },
    { executionScope: "standalone", pattern: /\bstandalone(?:\s+automation)?\b/i },
    { executionScope: "standalone", pattern: /\bseparate\s+(?:run|automation|task)\b/i },
    {
      executionScope: "standalone",
      pattern: /\b(?:as|in|into|inside|within)\s+(?:a\s+)?(?:new|separate)\s+run\b/i,
    },
    {
      executionScope: "standalone",
      pattern: /\bfor\s+(?:every|each|all)\s+(?:new\s+)?chats?\b/i,
    },
    {
      executionScope: "standalone",
      pattern: /\b(?:per|in)\s+ogni\s+(?:nuova\s+)?chat\b/i,
    },
  ];

  for (const { executionScope, pattern } of patterns) {
    const match = pattern.exec(value);
    if (!match) {
      continue;
    }
    return {
      executionScope,
      textWithoutExecutionScope: removeMatchedText(value, match),
    };
  }

  return null;
}

export function detectChatAutomationExecutionScope(value: string): ChatAutomationExecutionScope {
  return extractExecutionScope(value)?.executionScope ?? "thread";
}

export function extractStopClause(value: string): ParsedStopClause | null {
  const patterns: readonly RegExp[] = [
    /\bstop\s+when\s+(.+?)(?=(?:[.!?]\s+|$))/i,
    /\buntil\s+(.+?)(?=(?:[.!?]\s+|$))/i,
    /\bkeep\s+monitoring\s+until\s+(.+?)(?=(?:[.!?]\s+|$))/i,
    /\bif\s+(.+?),\s*stop\b/i,
    /\bquando\s+(.+?),\s*fermati\b/i,
    /\bfinch[eé]\s+(.+?)(?=(?:[.!?]\s+|$))/i,
    /\bfino\s+a\s+quando\s+(.+?)(?=(?:[.!?]\s+|$))/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    const stopWhen = match?.[1]
      ?.trim()
      .replace(/[.!?]+$/g, "")
      .trim();
    if (!match || !stopWhen) {
      continue;
    }
    const textWithoutStopClause = normalizeInlineText(
      `${value.slice(0, match.index)} ${value.slice(match.index + match[0].length)}`,
    )
      .replace(/([.!?])\s+[.!?]/g, "$1")
      .replace(/^(?:and|then|e|poi)\s+/i, "");
    return {
      stopWhen,
      textWithoutStopClause,
    };
  }
  return null;
}

export function extractIterationLimit(value: string): ParsedIterationLimit | null {
  const patterns: readonly RegExp[] = [
    /\bfor\s+(\d{1,4})\s+(?:times?|runs?|iterations?|turns?)(?:\s+(?:in\s+)?total)?\b/i,
    /\b(?:a\s+)?total\s+of\s+(\d{1,4})\s+(?:times?|runs?|iterations?|turns?)\b/i,
    /\b(\d{1,4})\s+(?:times?|runs?|iterations?|turns?)\s+(?:(?:in\s+)?total|overall)\b/i,
    /\bper\s+(\d{1,4})\s+(?:volte|iterazioni|run|giri)(?:\s+in\s+totale)?\b/i,
    /\b(?:per\s+)?un\s+totale\s+di\s+(\d{1,4})\s+(?:volte|iterazioni|run|giri)\b/i,
    /\b(\d{1,4})\s+(?:volte|iterazioni|run|giri)\s+in\s+totale\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    const amount = Number.parseInt(match?.[1] ?? "", 10);
    if (!match || !Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    const textWithoutIterationLimit = removeMatchedText(value, match).replace(/(?:,\s*)$/g, "");
    return {
      maxIterations: amount,
      textWithoutIterationLimit,
    };
  }
  return null;
}
