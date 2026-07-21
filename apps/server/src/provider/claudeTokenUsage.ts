import type { ModelUsage, NonNullableUsage } from "@anthropic-ai/claude-agent-sdk";
import type { ModelCapabilities, ThreadTokenUsageSnapshot } from "@agent-group/contracts";
import {
  getDefaultAutoCompactWindow,
  getModelCapabilities,
  hasAutoCompactWindowOption,
  trimOrNull,
} from "@agent-group/shared/model";

import { positiveFiniteNumber } from "./tokenUsage.ts";

export interface ClaudeContextBudgetState {
  readonly lastKnownAutoCompactThreshold: number | undefined;
  readonly currentAutoCompactWindow: number | undefined;
  readonly lastKnownContextWindow: number | undefined;
}

export interface ClaudeModelRefusalFallback {
  readonly originalModel: string;
  readonly fallbackModel: string;
  readonly content?: string;
}

export function maxClaudeContextWindowFromModelUsage(
  modelUsage: Record<string, ModelUsage> | undefined,
): number | undefined {
  if (!modelUsage) return undefined;
  let maxContextWindow: number | undefined;
  for (const value of Object.values(modelUsage)) {
    const contextWindow = positiveFiniteNumber(value.contextWindow);
    if (contextWindow === undefined) continue;
    maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow);
  }
  return maxContextWindow;
}

function finiteTokenCountOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function claudePromptTokensFromRawUsage(usage: Record<string, unknown>): number {
  return (
    finiteTokenCountOrZero(usage.input_tokens) +
    finiteTokenCountOrZero(usage.cache_creation_input_tokens) +
    finiteTokenCountOrZero(usage.cache_read_input_tokens)
  );
}

export function formatApproxTokens(tokens: number): string {
  return tokens >= 1_000 ? `~${Math.round(tokens / 1_000)}k` : String(Math.round(tokens));
}

export function claudeEffectiveContextBudget(
  context: ClaudeContextBudgetState,
): number | undefined {
  const autoCompactBudget =
    context.lastKnownAutoCompactThreshold ?? context.currentAutoCompactWindow;
  const modelCapacity = context.lastKnownContextWindow;
  if (autoCompactBudget !== undefined && modelCapacity !== undefined) {
    return Math.min(autoCompactBudget, modelCapacity);
  }
  return autoCompactBudget ?? modelCapacity;
}

export function stripClaudeContextWindowSuffix(apiModelId: string): string {
  return apiModelId.replace(/\[[^\]]+\]$/u, "");
}

export function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function readClaudeModelRefusalFallback(
  message: unknown,
): ClaudeModelRefusalFallback | undefined {
  if (!message || typeof message !== "object") return undefined;
  const record = message as {
    type?: unknown;
    subtype?: unknown;
    original_model?: unknown;
    fallback_model?: unknown;
    originalModel?: unknown;
    fallbackModel?: unknown;
    content?: unknown;
  };
  if (record.type !== "system" || record.subtype !== "model_refusal_fallback") return undefined;
  const originalModel =
    readNonEmptyString(record.original_model) ?? readNonEmptyString(record.originalModel);
  const fallbackModel =
    readNonEmptyString(record.fallback_model) ?? readNonEmptyString(record.fallbackModel);
  if (!originalModel || !fallbackModel) return undefined;
  return {
    originalModel,
    fallbackModel,
    ...(typeof record.content === "string" && record.content.trim().length > 0
      ? { content: record.content }
      : {}),
  };
}

export function normalizeClaudeTokenUsage(
  value: NonNullableUsage | Record<string, unknown> | undefined,
  contextWindow?: number,
): ThreadTokenUsageSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const inputTokens =
    finiteTokenCountOrZero(usage.input_tokens) +
    finiteTokenCountOrZero(usage.cache_creation_input_tokens) +
    finiteTokenCountOrZero(usage.cache_read_input_tokens);
  const outputTokens = finiteTokenCountOrZero(usage.output_tokens);
  const derivedTotalProcessedTokens = inputTokens + outputTokens;
  const totalProcessedTokens =
    (typeof usage.total_tokens === "number" && Number.isFinite(usage.total_tokens)
      ? usage.total_tokens
      : undefined) ?? (derivedTotalProcessedTokens > 0 ? derivedTotalProcessedTokens : undefined);
  if (totalProcessedTokens === undefined || totalProcessedTokens <= 0) return undefined;
  const maxTokens = positiveFiniteNumber(contextWindow);
  const usedTokens =
    maxTokens !== undefined ? Math.min(totalProcessedTokens, maxTokens) : totalProcessedTokens;
  return {
    usedTokens,
    lastUsedTokens: usedTokens,
    ...(totalProcessedTokens > usedTokens ? { totalProcessedTokens } : {}),
    ...(inputTokens > 0 ? { inputTokens } : {}),
    ...(outputTokens > 0 ? { outputTokens } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(typeof usage.tool_uses === "number" && Number.isFinite(usage.tool_uses)
      ? { toolUses: usage.tool_uses }
      : {}),
    ...(typeof usage.duration_ms === "number" && Number.isFinite(usage.duration_ms)
      ? { durationMs: usage.duration_ms }
      : {}),
  };
}

export function mergeClaudeTokenUsageSnapshot(
  previous: ThreadTokenUsageSnapshot,
  accumulated: ThreadTokenUsageSnapshot | undefined,
  contextWindow?: number,
): ThreadTokenUsageSnapshot {
  const maxTokens = positiveFiniteNumber(contextWindow);
  const usedTokens =
    maxTokens !== undefined ? Math.min(previous.usedTokens, maxTokens) : previous.usedTokens;
  const lastUsedTokens =
    previous.lastUsedTokens !== undefined
      ? maxTokens !== undefined
        ? Math.min(previous.lastUsedTokens, maxTokens)
        : previous.lastUsedTokens
      : usedTokens;
  const totalProcessedTokens = Math.max(
    previous.totalProcessedTokens ?? previous.usedTokens,
    accumulated?.totalProcessedTokens ?? accumulated?.usedTokens ?? 0,
    usedTokens,
  );
  return {
    ...previous,
    usedTokens,
    lastUsedTokens,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(totalProcessedTokens > usedTokens ? { totalProcessedTokens } : {}),
  };
}

export const CLAUDE_ONE_MILLION_CONTEXT_WINDOW_TOKENS = 1_000_000;

const CLAUDE_CONTEXT_WINDOW_MAX_TOKENS = {
  "200k": 200_000,
  "512k": 512_000,
  "1m": CLAUDE_ONE_MILLION_CONTEXT_WINDOW_TOKENS,
} as const;

export function resolveClaudeApiModelIdContextWindowMaxTokens(
  apiModelId: string | undefined,
  capabilities: ModelCapabilities = getModelCapabilities(
    "claudeAgent",
    stripClaudeContextWindowSuffix(apiModelId ?? ""),
  ),
): number | undefined {
  if (!apiModelId) return undefined;
  return positiveFiniteNumber(capabilities.contextWindowTokens);
}

export function resolveSelectedClaudeAutoCompactWindow(
  model: string | null | undefined,
  selectedAutoCompactWindow: string | null | undefined,
  capabilities: ModelCapabilities = getModelCapabilities("claudeAgent", model),
): number | undefined {
  const caps = capabilities;
  const resolvedAutoCompactWindow =
    trimOrNull(selectedAutoCompactWindow) ?? getDefaultAutoCompactWindow(caps) ?? null;
  if (
    !resolvedAutoCompactWindow ||
    !hasAutoCompactWindowOption(caps, resolvedAutoCompactWindow) ||
    !Object.prototype.hasOwnProperty.call(
      CLAUDE_CONTEXT_WINDOW_MAX_TOKENS,
      resolvedAutoCompactWindow,
    )
  ) {
    return undefined;
  }
  return CLAUDE_CONTEXT_WINDOW_MAX_TOKENS[
    resolvedAutoCompactWindow as keyof typeof CLAUDE_CONTEXT_WINDOW_MAX_TOKENS
  ];
}

export function resolveEffectiveClaudeContextWindow(input: {
  readonly reportedContextWindow: number | undefined;
  readonly lastKnownContextWindow: number | undefined;
}): number | undefined {
  if (input.reportedContextWindow !== undefined && input.lastKnownContextWindow !== undefined) {
    return Math.max(input.reportedContextWindow, input.lastKnownContextWindow);
  }
  return input.reportedContextWindow ?? input.lastKnownContextWindow;
}

export { finiteTokenCountOrZero };
