import { completionPolicyFromStopWhen } from "../automationCompletionPolicy";
import { extractExecutionScope, extractIterationLimit, extractStopClause } from "./clauses";
import {
  extractChatAutomationInvocation,
  isLikelyAutomationQuestionCandidate,
  isLikelyPlainAutomationAction,
  stripPlainAutomationPoliteRequest,
} from "./invocation";
import { deriveAutomationIntentName, stripAutomationScaffold } from "./prompt";
import { parseSchedule } from "./schedule";
import { normalizeInlineText, normalizeSearchText } from "./text";
import type { ChatAutomationIntent } from "./types";

export function parseChatAutomationInvocation(
  invocation: string,
  options: { readonly nowIso?: string } = {},
): ChatAutomationIntent | null {
  const normalizedInvocation = normalizeInlineText(invocation);
  if (!normalizedInvocation) {
    return null;
  }

  const executionScope = extractExecutionScope(normalizedInvocation);
  const scopedInvocation = executionScope?.textWithoutExecutionScope ?? normalizedInvocation;
  const searchText = normalizeSearchText(scopedInvocation);
  const parsedSchedule = parseSchedule(searchText, options.nowIso ?? new Date().toISOString());
  if (!parsedSchedule) {
    return null;
  }

  const iterationLimit = extractIterationLimit(scopedInvocation);
  const prompt = stripAutomationScaffold(
    iterationLimit?.textWithoutIterationLimit ?? scopedInvocation,
  );
  if (!prompt) {
    return null;
  }
  const stopClause = extractStopClause(prompt);
  const taskPrompt = stopClause?.textWithoutStopClause
    ? stripAutomationScaffold(stopClause.textWithoutStopClause)
    : prompt;
  if (!taskPrompt) {
    return null;
  }
  return {
    name: deriveAutomationIntentName(taskPrompt),
    prompt: taskPrompt,
    schedule: parsedSchedule.schedule,
    cadenceLabel: parsedSchedule.cadenceLabel,
    maxIterations: iterationLimit?.maxIterations ?? null,
    completionPolicy: completionPolicyFromStopWhen(stopClause?.stopWhen ?? ""),
    executionScope: executionScope?.executionScope ?? "thread",
  };
}

export function parsePlainChatAutomationInvocation(
  invocation: string,
  options: { readonly nowIso?: string } = {},
): ChatAutomationIntent | null {
  const normalizedInvocation = normalizeInlineText(invocation);
  if (!normalizedInvocation) {
    return null;
  }
  const politeInvocation = stripPlainAutomationPoliteRequest(normalizedInvocation);
  const candidate = politeInvocation ?? normalizedInvocation;
  if (!isLikelyPlainAutomationAction(candidate, politeInvocation !== null)) {
    return null;
  }
  const candidateIsQuestion =
    politeInvocation === null
      ? isLikelyAutomationQuestionCandidate(normalizedInvocation)
      : isLikelyAutomationQuestionCandidate(candidate);
  if (candidateIsQuestion) {
    return null;
  }
  return parseChatAutomationInvocation(candidate, options);
}

export function parseChatAutomationIntent(
  value: string,
  options: { readonly nowIso?: string } = {},
): ChatAutomationIntent | null {
  const invocation = extractChatAutomationInvocation(value);
  if (invocation === null) {
    return null;
  }
  return parseChatAutomationInvocation(invocation, options);
}
