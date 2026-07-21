import {
  BARE_INTERVAL_LEADING_ACTION_PATTERN,
  PLAIN_INVOCATION_ACTION_PREFIX_PATTERN,
  PLAIN_INVOCATION_AUTOMATION_CREATION_PREFIX_PATTERN,
  PLAIN_INVOCATION_POLITE_ACTION_PREFIX_PATTERN,
  PLAIN_INVOCATION_POLITE_REQUEST_PATTERN,
  PLAIN_INVOCATION_QUESTION_PREFIX_PATTERN,
} from "./constants";
import { normalizeInlineText, normalizeSearchText } from "./text";

export function isLikelyPlainAutomationQuestion(value: string): boolean {
  const text = normalizeInlineText(value);
  if (!text) {
    return false;
  }
  if (/[?？]\s*$/.test(text)) {
    return true;
  }
  return PLAIN_INVOCATION_QUESTION_PREFIX_PATTERN.test(normalizeSearchText(text));
}

export function isLikelyAutomationQuestionCandidate(value: string): boolean {
  if (isLikelyPlainAutomationQuestion(value)) {
    return true;
  }
  return /^tell me\s+(?:what|why|how|who|when|where|which|qual|quale|quali|cosa|come|perche|dove|quando|chi)\b/.test(
    normalizeSearchText(value),
  );
}

export function stripPlainAutomationPoliteRequest(value: string): string | null {
  const normalized = normalizeInlineText(value);
  const match = PLAIN_INVOCATION_POLITE_REQUEST_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }
  return normalizeInlineText(normalized.slice(match[0].length))
    .replace(/[?？]+$/g, "")
    .replace(/^(?:to|di|che)\s+/i, "");
}

export function isLikelyPlainAutomationAction(value: string, politeRequest: boolean): boolean {
  const pattern = politeRequest
    ? PLAIN_INVOCATION_POLITE_ACTION_PREFIX_PATTERN
    : PLAIN_INVOCATION_ACTION_PREFIX_PATTERN;
  const normalized = normalizeInlineText(value);
  return (
    pattern.test(normalized) ||
    PLAIN_INVOCATION_AUTOMATION_CREATION_PREFIX_PATTERN.test(normalized) ||
    BARE_INTERVAL_LEADING_ACTION_PATTERN.test(normalized)
  );
}

export function extractPlainChatAutomationCreationInvocation(value: string): string | null {
  const normalizedInvocation = normalizeInlineText(value);
  if (!normalizedInvocation) {
    return null;
  }
  const politeInvocation = stripPlainAutomationPoliteRequest(normalizedInvocation);
  const candidate = politeInvocation ?? normalizedInvocation;
  const candidateIsQuestion =
    politeInvocation === null
      ? isLikelyAutomationQuestionCandidate(normalizedInvocation)
      : isLikelyAutomationQuestionCandidate(candidate);
  if (candidateIsQuestion) {
    return null;
  }
  return PLAIN_INVOCATION_AUTOMATION_CREATION_PREFIX_PATTERN.test(candidate) ? candidate : null;
}

export function ensureAutomationConversationScaffold(message: string): string {
  const normalized = normalizeInlineText(message);
  if (!normalized) {
    return "create an automation";
  }
  if (PLAIN_INVOCATION_AUTOMATION_CREATION_PREFIX_PATTERN.test(normalized)) {
    return normalized;
  }
  return `create an automation ${normalized}`;
}

export function extractChatAutomationInvocation(value: string): string | null {
  const text = normalizeInlineText(value);
  if (!text) {
    return null;
  }

  const slashMatch = /^\/automation(?:\s+([\s\S]*))?$/i.exec(text);
  if (slashMatch) {
    return normalizeInlineText(slashMatch[1] ?? "");
  }

  const withoutInlineMarker = text.replace(
    /(^|\s)(?:@automation(?::)?|\/automation)(?=\s|$)/i,
    " ",
  );
  if (withoutInlineMarker !== text) {
    return normalizeInlineText(withoutInlineMarker);
  }

  return null;
}
