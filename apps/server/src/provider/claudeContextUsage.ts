import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { ThreadTokenUsageSnapshot } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import type { ClaudeSessionContext } from "./claudeAdapterRuntime.ts";
import { toError } from "./claudeAdapterErrors.ts";
import {
  claudeEffectiveContextBudget,
  claudePromptTokensFromRawUsage,
  finiteTokenCountOrZero,
  formatApproxTokens,
} from "./claudeTokenUsage.ts";
import { positiveFiniteNumber } from "./tokenUsage.ts";

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const CONTEXT_WARNING_RATIO = 0.8;
const CONTEXT_USAGE_TIMEOUT_MS = 1_000;

export function makeClaudeContextUsage(input: {
  readonly emitRuntimeWarning: (
    context: ClaudeSessionContext,
    message: string,
    detail?: unknown,
  ) => Effect.Effect<void>;
}) {
  const maybeEmitWarning = (
    context: ClaudeSessionContext,
    rawUsage: Record<string, unknown>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const promptTokens = claudePromptTokensFromRawUsage(rawUsage);
      if (promptTokens <= 0) {
        return;
      }
      const cachedReadTokens = finiteTokenCountOrZero(rawUsage.cache_read_input_tokens);
      const uncachedTokens = Math.max(0, promptTokens - cachedReadTokens);
      const composition =
        cachedReadTokens > 0
          ? ` (${formatApproxTokens(cachedReadTokens)} cached reads, ${formatApproxTokens(uncachedTokens)} new/cache-write)`
          : "";
      const contextBudget = claudeEffectiveContextBudget(context) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
      if (
        promptTokens > contextBudget * CONTEXT_WARNING_RATIO &&
        !context.emittedContextUsageWarnings.has("near-window")
      ) {
        context.emittedContextUsageWarnings.add("near-window");
        yield* input.emitRuntimeWarning(
          context,
          `Claude context is above 80% of the ${Math.round(contextBudget / 1_000)}k auto-compact budget (${formatApproxTokens(promptTokens)} logical prompt tokens${composition}). Consider compacting or starting a fresh thread; cached reads cost less than fresh input.`,
        );
        return;
      }
      if (
        promptTokens > DEFAULT_CONTEXT_WINDOW_TOKENS &&
        !context.emittedContextUsageWarnings.has("large-prompt")
      ) {
        context.emittedContextUsageWarnings.add("large-prompt");
        yield* input.emitRuntimeWarning(
          context,
          `Claude is processing ${formatApproxTokens(promptTokens)} logical prompt tokens per request${composition}. Large active contexts can consume usage faster; cached reads cost less than fresh input.`,
        );
      }
    });

  const read = (
    context: ClaudeSessionContext,
  ): Effect.Effect<SDKControlGetContextUsageResponse | undefined> => {
    if (!context.contextUsageControlEnabled) {
      return Effect.succeed(undefined);
    }
    return Effect.tryPromise({
      try: () => context.query.getContextUsage(),
      catch: (cause) => toError(cause, "Failed to read Claude context usage."),
    }).pipe(
      Effect.timeoutOption(CONTEXT_USAGE_TIMEOUT_MS),
      Effect.map(
        Option.match({
          onNone: () => {
            context.contextUsageControlEnabled = false;
            return undefined;
          },
          onSome: (usage) => usage,
        }),
      ),
      Effect.catch(() => Effect.succeed(undefined)),
    );
  };

  const snapshot = (
    usage: SDKControlGetContextUsageResponse,
    totalProcessedTokens?: number,
  ): ThreadTokenUsageSnapshot => {
    const effectiveMaxTokens =
      positiveFiniteNumber(usage.autoCompactThreshold) ??
      positiveFiniteNumber(usage.maxTokens) ??
      positiveFiniteNumber(usage.rawMaxTokens);
    const usedTokens = Math.max(0, Math.round(usage.totalTokens));
    const inputTokens = Math.max(
      0,
      Math.round(
        (usage.apiUsage?.input_tokens ?? 0) +
          (usage.apiUsage?.cache_creation_input_tokens ?? 0) +
          (usage.apiUsage?.cache_read_input_tokens ?? 0),
      ),
    );
    const cachedInputTokens = Math.max(0, Math.round(usage.apiUsage?.cache_read_input_tokens ?? 0));
    const outputTokens = Math.max(0, Math.round(usage.apiUsage?.output_tokens ?? 0));
    return {
      usedTokens:
        effectiveMaxTokens !== undefined ? Math.min(usedTokens, effectiveMaxTokens) : usedTokens,
      lastUsedTokens: usedTokens,
      ...(effectiveMaxTokens !== undefined
        ? {
            maxTokens: effectiveMaxTokens,
            usedPercent: Math.min(100, (usedTokens / effectiveMaxTokens) * 100),
          }
        : {}),
      ...(totalProcessedTokens !== undefined && totalProcessedTokens > usedTokens
        ? { totalProcessedTokens }
        : {}),
      ...(inputTokens > 0 ? { inputTokens, lastInputTokens: inputTokens } : {}),
      ...(cachedInputTokens > 0
        ? { cachedInputTokens, lastCachedInputTokens: cachedInputTokens }
        : {}),
      ...(outputTokens > 0 ? { outputTokens, lastOutputTokens: outputTokens } : {}),
      compactsAutomatically: usage.isAutoCompactEnabled,
    };
  };

  return { maybeEmitWarning, read, snapshot };
}
