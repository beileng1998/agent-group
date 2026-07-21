import type {
  EffortOption,
  ModelCapabilities,
  ProviderContextWindowDescriptor,
  ProviderModelDescriptor,
} from "@agent-group/contracts";
import { getModelCapabilities } from "@agent-group/shared/model";

import { stripClaudeContextWindowSuffix } from "./claudeTokenUsage.ts";

export const KIMI_K3_DEFAULT_CONTEXT_WINDOW_TOKENS = 512_000;
export const KIMI_K3_MAX_CONTEXT_WINDOW_TOKENS = 1_000_000;

const KIMI_K3_AUTO_COMPACT_WINDOWS = [
  { value: "512k", label: "512K", isDefault: true },
  { value: "1m", label: "1M" },
] as const satisfies ReadonlyArray<ProviderContextWindowDescriptor>;

function normalizedClaudeModelId(model: string | null | undefined): string {
  return stripClaudeContextWindowSuffix(model?.trim().toLowerCase() ?? "");
}

export function knownClaudeModelCapabilities(
  model: string | null | undefined,
): Partial<ProviderModelDescriptor> | undefined {
  if (normalizedClaudeModelId(model) !== "kimi-k3") {
    return undefined;
  }
  return {
    supportedReasoningEfforts: [
      { value: "high", label: "High" },
      { value: "max", label: "Max" },
    ],
    defaultReasoningEffort: "high",
    supportsAdaptiveThinking: true,
    autoCompactWindowOptions: [...KIMI_K3_AUTO_COMPACT_WINDOWS],
    contextWindowTokens: KIMI_K3_MAX_CONTEXT_WINDOW_TOKENS,
  };
}

function runtimeEffortLabel(value: string): string {
  switch (value) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "Extra High";
    case "max":
      return "Max";
    default:
      return value;
  }
}

function runtimeEfforts(
  model: Pick<ProviderModelDescriptor, "supportedReasoningEfforts" | "defaultReasoningEffort">,
): EffortOption[] | undefined {
  if (!model.supportedReasoningEfforts) {
    return undefined;
  }
  const defaultEffort =
    model.defaultReasoningEffort ??
    (model.supportedReasoningEfforts.some((effort) => effort.value === "high") ? "high" : undefined);
  return model.supportedReasoningEfforts.map((effort) => ({
    value: effort.value,
    label: effort.label ?? runtimeEffortLabel(effort.value),
    ...(effort.description ? { description: effort.description } : {}),
    ...(effort.value === defaultEffort ? { isDefault: true as const } : {}),
  }));
}

export function resolveClaudeModelCapabilities(
  model: string | null | undefined,
  discovered?: ProviderModelDescriptor | undefined,
): ModelCapabilities {
  const staticCapabilities = getModelCapabilities("claudeAgent", model);
  const known = knownClaudeModelCapabilities(model);
  const runtimeModel = discovered ? { ...known, ...discovered } : known;
  if (!runtimeModel) {
    return staticCapabilities;
  }

  const efforts = runtimeEfforts(runtimeModel);
  return {
    ...staticCapabilities,
    ...(efforts ? { reasoningEffortLevels: efforts } : {}),
    supportsFastMode: runtimeModel.supportsFastMode ?? staticCapabilities.supportsFastMode,
    supportsThinkingToggle:
      runtimeModel.supportsThinkingToggle ?? staticCapabilities.supportsThinkingToggle,
    ...(runtimeModel.contextWindowOptions
      ? { contextWindowOptions: runtimeModel.contextWindowOptions }
      : {}),
    ...(runtimeModel.autoCompactWindowOptions
      ? { autoCompactWindowOptions: runtimeModel.autoCompactWindowOptions }
      : {}),
    ...(runtimeModel.contextWindowTokens
      ? { contextWindowTokens: runtimeModel.contextWindowTokens }
      : {}),
  };
}
