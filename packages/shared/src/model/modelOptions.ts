import {
  CodexReasoningEffort,
  type AntigravityModelOptions,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type CursorModelOptions,
  type DroidModelOptions,
  type GrokModelOptions,
  type GrokReasoningEffort,
  type ModelCapabilities,
  type OpenCodeModelOptions,
  type PiModelOptions,
  type PiThinkingLevel,
} from "@agent-group/contracts";
import {
  getDefaultAutoCompactWindow,
  getDefaultEffort,
  getModelCapabilities,
  hasAutoCompactWindowOption,
  hasEffortLevel,
} from "./modelCapabilities";
import { trimOrNull } from "./modelSlugs";

const PI_THINKING_LEVEL_SET = new Set<PiThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function normalizeCodexModelOptions(
  model: string | null | undefined,
  modelOptions: CodexModelOptions | null | undefined,
): CodexModelOptions | undefined {
  const caps = getModelCapabilities("codex", model);
  const defaultReasoningEffort = getDefaultEffort(caps) as CodexReasoningEffort;
  const reasoningEffort = trimOrNull(modelOptions?.reasoningEffort) ?? defaultReasoningEffort;
  const fastModeEnabled = modelOptions?.fastMode === true;
  const nextOptions: CodexModelOptions = {
    ...(reasoningEffort !== defaultReasoningEffort ? { reasoningEffort } : {}),
    ...(fastModeEnabled ? { fastMode: true } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function normalizeClaudeModelOptions(
  model: string | null | undefined,
  modelOptions: ClaudeModelOptions | null | undefined,
  capabilities: ModelCapabilities = getModelCapabilities("claudeAgent", model),
): ClaudeModelOptions | undefined {
  const caps = capabilities;
  const defaultReasoningEffort = getDefaultEffort(caps);
  const defaultAutoCompactWindow = getDefaultAutoCompactWindow(caps);
  const resolvedEffort = trimOrNull(modelOptions?.effort);
  const resolvedAutoCompactWindow =
    trimOrNull(modelOptions?.autoCompactWindow) ?? trimOrNull(modelOptions?.contextWindow);
  const isPromptInjected = caps.promptInjectedEffortLevels.includes(resolvedEffort ?? "");
  const effort =
    resolvedEffort &&
    !isPromptInjected &&
    hasEffortLevel(caps, resolvedEffort) &&
    resolvedEffort !== defaultReasoningEffort
      ? resolvedEffort
      : undefined;
  const autoCompactWindow =
    resolvedAutoCompactWindow &&
    hasAutoCompactWindowOption(caps, resolvedAutoCompactWindow) &&
    resolvedAutoCompactWindow !== defaultAutoCompactWindow
      ? resolvedAutoCompactWindow
      : undefined;
  const thinking =
    caps.supportsThinkingToggle && modelOptions?.thinking === false ? false : undefined;
  const fastMode = caps.supportsFastMode && modelOptions?.fastMode === true ? true : undefined;
  const nextOptions: ClaudeModelOptions = {
    ...(thinking === false ? { thinking: false } : {}),
    ...(effort ? { effort } : {}),
    ...(fastMode ? { fastMode: true } : {}),
    ...(autoCompactWindow ? { autoCompactWindow } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function normalizeGrokModelOptions(
  model: string | null | undefined,
  modelOptions: GrokModelOptions | null | undefined,
): GrokModelOptions | undefined {
  const caps = getModelCapabilities("grok", model);
  const reasoningEffort = trimOrNull(modelOptions?.reasoningEffort);
  if (!reasoningEffort || !hasEffortLevel(caps, reasoningEffort)) {
    return undefined;
  }
  if (reasoningEffort === getDefaultEffort(caps)) {
    return undefined;
  }
  return { reasoningEffort: reasoningEffort as GrokReasoningEffort };
}

export function normalizeAntigravityModelOptions(
  model: string | null | undefined,
  modelOptions: AntigravityModelOptions | null | undefined,
  capabilities: ModelCapabilities = getModelCapabilities("antigravity", model),
): AntigravityModelOptions | undefined {
  const reasoningEffort = trimOrNull(modelOptions?.reasoningEffort);
  if (!reasoningEffort || !hasEffortLevel(capabilities, reasoningEffort)) {
    return undefined;
  }
  if (reasoningEffort === getDefaultEffort(capabilities)) {
    return undefined;
  }
  return { reasoningEffort };
}

export function normalizeDroidModelOptions(
  _model: string | null | undefined,
  modelOptions: DroidModelOptions | null | undefined,
): DroidModelOptions | undefined {
  const reasoningEffort = trimOrNull(modelOptions?.reasoningEffort);
  return reasoningEffort ? { reasoningEffort } : undefined;
}

export function normalizePiModelOptions(
  modelOptions: PiModelOptions | null | undefined,
): PiModelOptions | undefined {
  const thinkingLevel = trimOrNull(modelOptions?.thinkingLevel);
  return thinkingLevel && PI_THINKING_LEVEL_SET.has(thinkingLevel as PiThinkingLevel)
    ? { thinkingLevel: thinkingLevel as PiThinkingLevel }
    : undefined;
}

export function normalizeOpenCodeModelOptions(
  modelOptions: OpenCodeModelOptions | null | undefined,
): OpenCodeModelOptions | undefined {
  const variant = trimOrNull(modelOptions?.variant);
  const agent = trimOrNull(modelOptions?.agent);
  const nextOptions: OpenCodeModelOptions = {
    ...(variant ? { variant } : {}),
    ...(agent ? { agent } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function normalizeCursorModelOptions(
  modelOptions: CursorModelOptions | null | undefined,
): CursorModelOptions | undefined {
  const nextOptions: CursorModelOptions = {
    ...(modelOptions?.reasoningEffort ? { reasoningEffort: modelOptions.reasoningEffort } : {}),
    ...(modelOptions?.fastMode !== undefined ? { fastMode: modelOptions.fastMode } : {}),
    ...(modelOptions?.thinking !== undefined ? { thinking: modelOptions.thinking } : {}),
    ...(modelOptions?.contextWindow ? { contextWindow: modelOptions.contextWindow } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}
