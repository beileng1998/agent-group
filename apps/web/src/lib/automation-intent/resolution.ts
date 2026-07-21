import type { AutomationMode, ServerGenerateAutomationIntentResult } from "@agent-group/contracts";

import {
  modeForCompletionPolicy,
  requiresCompletionPolicyReview,
} from "../automationCompletionPolicy";
import { extractExecutionScope, extractIterationLimit, extractStopClause } from "./clauses";
import {
  GENERATED_INTENT_CONFIDENCE_THRESHOLD,
  PROMPT_ENRICHMENT_MAX_LENGTH,
  PROMPT_ENRICHMENT_MAX_WORDS,
} from "./constants";
import { deriveAutomationIntentName, stripAutomationScaffold } from "./prompt";
import { formatAutomationIntentCadence } from "./schedule";
import { normalizeInlineText, wordCount } from "./text";
import type {
  ChatAutomationExecutionScope,
  ChatAutomationIntent,
  ResolvedChatAutomationIntent,
} from "./types";

export function shouldGenerateAutomationIntent(input: {
  readonly deterministicIntent: ChatAutomationIntent | null;
  readonly automationMessage: string;
}): boolean {
  const message = normalizeInlineText(input.automationMessage);
  if (!message) {
    return false;
  }
  if (!input.deterministicIntent) {
    return true;
  }
  const prompt = normalizeInlineText(input.deterministicIntent.prompt);
  return (
    prompt.length > 0 &&
    (prompt.length <= PROMPT_ENRICHMENT_MAX_LENGTH ||
      wordCount(prompt) <= PROMPT_ENRICHMENT_MAX_WORDS)
  );
}

function stripGeneratedPromptScaffolding(value: string): string {
  const withoutExecutionScope = extractExecutionScope(value)?.textWithoutExecutionScope ?? value;
  const withoutIterationLimit =
    extractIterationLimit(withoutExecutionScope)?.textWithoutIterationLimit ??
    withoutExecutionScope;
  const withoutSchedule = stripAutomationScaffold(withoutIterationLimit);
  const stopClause = extractStopClause(withoutSchedule);
  return normalizeInlineText(
    stopClause?.textWithoutStopClause
      ? stripAutomationScaffold(stopClause.textWithoutStopClause)
      : withoutSchedule,
  );
}

function maxIterationsFromGeneratedIntent(
  generatedIntent: ServerGenerateAutomationIntentResult,
): number | null {
  return (
    generatedIntent.maxIterations ??
    (generatedIntent.taskPrompt
      ? (extractIterationLimit(generatedIntent.taskPrompt)?.maxIterations ?? null)
      : null)
  );
}

function generatedAutomationPromptEnrichment(
  generatedIntent: ServerGenerateAutomationIntentResult | null,
): Pick<ChatAutomationIntent, "name" | "prompt" | "maxIterations"> | null {
  if (
    generatedIntent?.isAutomation !== true ||
    generatedIntent.taskPrompt === null ||
    generatedIntent.confidence < GENERATED_INTENT_CONFIDENCE_THRESHOLD
  ) {
    return null;
  }
  const prompt = stripGeneratedPromptScaffolding(generatedIntent.taskPrompt);
  if (!prompt) {
    return null;
  }
  return {
    name: generatedIntent.name ?? deriveAutomationIntentName(prompt),
    prompt,
    maxIterations: maxIterationsFromGeneratedIntent(generatedIntent),
  };
}

function generatedAutomationIntentToChatIntent(
  generatedIntent: ServerGenerateAutomationIntentResult | null,
  executionScope: ChatAutomationExecutionScope,
): ChatAutomationIntent | null {
  if (generatedIntent?.isAutomation !== true || generatedIntent.taskPrompt === null) {
    return null;
  }

  if (
    generatedIntent.confidence < GENERATED_INTENT_CONFIDENCE_THRESHOLD &&
    !generatedIntent.needsConfirmation
  ) {
    return null;
  }

  const schedule = generatedIntent.schedule ?? { type: "manual" as const };
  const prompt = stripGeneratedPromptScaffolding(generatedIntent.taskPrompt);
  if (!prompt) {
    return null;
  }
  const resolvedExecutionScope = executionScopeForGeneratedMode(
    generatedIntent.mode,
    executionScope,
  );
  return {
    name: generatedIntent.name ?? deriveAutomationIntentName(prompt),
    prompt,
    schedule,
    cadenceLabel: formatAutomationIntentCadence(schedule),
    maxIterations: maxIterationsFromGeneratedIntent(generatedIntent),
    completionPolicy: generatedIntent.completionPolicy ?? { type: "none" },
    executionScope: resolvedExecutionScope,
  };
}

function executionScopeForGeneratedMode(
  mode: AutomationMode | null,
  fallback: ChatAutomationExecutionScope,
): ChatAutomationExecutionScope {
  if (mode === "heartbeat") {
    return "thread";
  }
  if (mode === "standalone") {
    return fallback === "worktree" ? "worktree" : "standalone";
  }
  return fallback;
}

export function resolveChatAutomationIntent(input: {
  readonly deterministicIntent: ChatAutomationIntent | null;
  readonly generatedIntent: ServerGenerateAutomationIntentResult | null;
  readonly defaultMode: AutomationMode;
  readonly executionScope: ChatAutomationExecutionScope;
}): ResolvedChatAutomationIntent | null {
  if (input.deterministicIntent) {
    const resolvedExecutionScope =
      input.deterministicIntent.executionScope === "thread"
        ? executionScopeForGeneratedMode(input.generatedIntent?.mode ?? null, input.executionScope)
        : input.deterministicIntent.executionScope;
    const requestedMode = resolvedExecutionScope === "thread" ? input.defaultMode : "standalone";
    const mode = modeForCompletionPolicy(requestedMode, input.deterministicIntent.completionPolicy);
    const enrichment = generatedAutomationPromptEnrichment(input.generatedIntent);
    const enrichmentNeedsConfirmation =
      enrichment !== null && (input.generatedIntent?.needsConfirmation ?? false);
    const deterministicIntent =
      resolvedExecutionScope === input.deterministicIntent.executionScope
        ? input.deterministicIntent
        : { ...input.deterministicIntent, executionScope: resolvedExecutionScope };
    const intent = enrichment
      ? {
          ...deterministicIntent,
          name: enrichment.name,
          prompt: enrichment.prompt,
          maxIterations: enrichment.maxIterations ?? deterministicIntent.maxIterations,
        }
      : deterministicIntent;
    return {
      intent,
      mode,
      source: "deterministic",
      requiresReview:
        enrichment !== null ||
        resolvedExecutionScope !== "thread" ||
        requiresCompletionPolicyReview(requestedMode, input.deterministicIntent.completionPolicy),
      generatedConfidence: enrichment ? (input.generatedIntent?.confidence ?? null) : null,
      generatedNeedsConfirmation: enrichmentNeedsConfirmation,
      reason: enrichmentNeedsConfirmation ? (input.generatedIntent?.reason ?? null) : null,
    };
  }

  const generatedIntent = generatedAutomationIntentToChatIntent(
    input.generatedIntent,
    input.executionScope,
  );
  if (!generatedIntent) {
    return null;
  }

  const generatedSchedule = input.generatedIntent?.schedule;
  const fastRecurringInterval =
    generatedSchedule?.type === "interval" && generatedSchedule.everySeconds < 60;

  const requestedMode =
    generatedIntent.executionScope === "thread" ? input.defaultMode : "standalone";
  const mode = modeForCompletionPolicy(requestedMode, generatedIntent.completionPolicy);
  return {
    intent: generatedIntent,
    mode,
    source: "generated",
    requiresReview: true,
    generatedConfidence: input.generatedIntent?.confidence ?? null,
    generatedNeedsConfirmation:
      (input.generatedIntent?.needsConfirmation ?? false) || fastRecurringInterval,
    reason: input.generatedIntent?.reason ?? null,
  };
}
