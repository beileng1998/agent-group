import {
  type OpenCodeModelOptions,
  type ProviderAgentDescriptor,
  type ProviderKind,
  type ProviderModelDescriptor,
} from "@agent-group/contracts";
import type { ProviderOptions } from "../../../providerModelOptions";
import { getComposerTraitSelection } from "../composerTraits";

export const ULTRATHINK_PROMPT_PREFIX = "Ultrathink:\n";

export function defaultAgentForProvider(provider: ProviderKind): string | null {
  if (provider === "kilo") return "code";
  if (provider === "opencode") return "build";
  return null;
}

export function getAgentOptions(
  provider: ProviderKind,
  runtimeAgents: ReadonlyArray<ProviderAgentDescriptor> | null | undefined,
): ReadonlyArray<ProviderAgentDescriptor> {
  if (provider !== "kilo" && provider !== "opencode") return [];
  return runtimeAgents ?? [];
}

export function getSelectedAgentValue(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined,
): string | null {
  const defaultAgent = defaultAgentForProvider(provider);
  if (!defaultAgent) return null;
  const selectedAgent = (modelOptions as OpenCodeModelOptions | undefined)?.agent?.trim();
  return selectedAgent && selectedAgent.length > 0 ? selectedAgent : defaultAgent;
}

function findAgentLabel(
  agents: ReadonlyArray<ProviderAgentDescriptor>,
  value: string | null,
): string | null {
  if (!value) return null;
  const agent = agents.find((candidate) => candidate.name === value);
  return agent?.displayName ?? value;
}

// Mirrors the trigger label assembly so callers (e.g. the composer footer
// width planner) can measure the summary without rendering the picker.
export function resolveTraitsTriggerSummary(options: {
  provider: ProviderKind;
  model: string | null | undefined;
  prompt: string;
  modelOptions: ProviderOptions | null | undefined;
  runtimeModel?: ProviderModelDescriptor | undefined;
  runtimeAgents: ReadonlyArray<ProviderAgentDescriptor> | null | undefined;
}): {
  contextWindowLabel: string | null;
  primaryLabel: string | null;
  showsFastBadge: boolean;
  summaryText: string;
} {
  const {
    caps,
    effort,
    effortLevels,
    thinkingEnabled,
    fastModeEnabled,
    fastModeDescriptor,
    contextWindow,
    contextWindowOptions,
    defaultContextWindow,
    ultrathinkPromptControlled,
  } = getComposerTraitSelection(
    options.provider,
    options.model,
    options.prompt,
    options.modelOptions,
    options.runtimeModel,
  );
  const supportsFastModeControl = fastModeDescriptor !== null || caps.supportsFastMode;
  const isFastOnlyControl =
    supportsFastModeControl &&
    effortLevels.length === 0 &&
    thinkingEnabled === null &&
    contextWindowOptions.length <= 1;
  const effortLabel = effort
    ? (effortLevels.find((level) => level.value === effort)?.label ?? effort)
    : null;
  const primaryLabel = ultrathinkPromptControlled
    ? "Ultrathink"
    : effortLabel
      ? effortLabel
      : thinkingEnabled !== null
        ? `Thinking ${thinkingEnabled ? "On" : "Off"}`
        : isFastOnlyControl
          ? fastModeEnabled
            ? "Fast"
            : "Default"
          : null;
  const contextWindowLabel =
    contextWindowOptions.length > 1 && contextWindow !== defaultContextWindow
      ? (contextWindowOptions.find((option) => option.value === contextWindow)?.label ?? null)
      : null;
  const agentOptions = getAgentOptions(options.provider, options.runtimeAgents);
  const selectedAgent = getSelectedAgentValue(options.provider, options.modelOptions);
  const agentLabel = findAgentLabel(agentOptions, selectedAgent);
  const resolvedPrimaryLabel = primaryLabel ?? agentLabel;
  const showsFastBadge = supportsFastModeControl && fastModeEnabled && !isFastOnlyControl;
  const summaryText = [resolvedPrimaryLabel, showsFastBadge ? "Fast" : null, contextWindowLabel]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return {
    contextWindowLabel,
    primaryLabel: resolvedPrimaryLabel,
    showsFastBadge,
    summaryText,
  };
}
