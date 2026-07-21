import {
  type ProviderAgentDescriptor,
  type ProviderKind,
  type ProviderModelDescriptor,
  type ThreadId,
} from "@agent-group/contracts";
import { applyClaudePromptEffortPrefix } from "@agent-group/shared/model";
import { memo, useCallback } from "react";
import { useComposerDraftStore } from "../../../composerDraftStore";
import {
  buildNextProviderOptions,
  buildProviderOptionPatch,
  type ProviderOptions,
} from "../../../providerModelOptions";
import { MenuSeparator as MenuDivider } from "../../ui/menu";
import { getComposerTraitSelection, hasVisibleComposerTraitControls } from "../composerTraits";
import { TraitRadioSection } from "./TraitRadioSection";
import {
  defaultAgentForProvider,
  getAgentOptions,
  getSelectedAgentValue,
  ULTRATHINK_PROMPT_PREFIX,
} from "./traitsPickerModel";

export interface TraitsMenuContentProps {
  provider: ProviderKind;
  threadId: ThreadId;
  model: string | null | undefined;
  runtimeModel?: ProviderModelDescriptor | undefined;
  runtimeModels?: ReadonlyArray<ProviderModelDescriptor> | null | undefined;
  runtimeAgents?: ReadonlyArray<ProviderAgentDescriptor> | null | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  includeFastMode?: boolean;
  modelOptions?: ProviderOptions | null | undefined;
  onSelectionComplete?: () => void;
}

export const TraitsMenuContent = memo(function TraitsMenuContentImpl({
  provider,
  threadId,
  model,
  runtimeModel,
  runtimeAgents,
  prompt,
  onPromptChange,
  includeFastMode = true,
  modelOptions,
  onSelectionComplete,
}: TraitsMenuContentProps) {
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const {
    caps,
    defaultEffort,
    effort,
    effortLevels,
    thinkingEnabled,
    fastModeEnabled,
    contextWindowOptions,
    contextWindow,
    defaultContextWindow,
    contextWindowDescriptor,
    ultrathinkPromptControlled,
    primarySelectDescriptor,
    fastModeDescriptor,
    promptInjectedValues,
  } = getComposerTraitSelection(provider, model, prompt, modelOptions, runtimeModel);
  const hasVisibleControls = hasVisibleComposerTraitControls(
    { caps, effortLevels, thinkingEnabled, contextWindowOptions, fastModeDescriptor },
    { includeFastMode },
  );
  const supportsFastModeControl = fastModeDescriptor !== null || caps.supportsFastMode;
  const agentOptions = getAgentOptions(provider, runtimeAgents);
  const defaultAgent = defaultAgentForProvider(provider);
  const selectedAgent = getSelectedAgentValue(provider, modelOptions);
  const hasAgentControls = agentOptions.length > 0 && defaultAgent !== null;
  const hasPriorContextWindowSection = thinkingEnabled !== null;
  const hasPriorEffortSection = thinkingEnabled !== null || contextWindowOptions.length > 1;
  const hasPriorFastModeSection =
    thinkingEnabled !== null || effortLevels.length > 0 || contextWindowOptions.length > 1;

  const commitTrait = useCallback(
    (patch: Record<string, unknown>) => {
      setProviderModelOptions(
        threadId,
        provider,
        buildNextProviderOptions(provider, modelOptions, patch),
        { ...(model !== undefined ? { model } : {}), persistSticky: true },
      );
      onSelectionComplete?.();
    },
    [threadId, provider, modelOptions, model, setProviderModelOptions, onSelectionComplete],
  );

  const handleEffortChange = useCallback(
    (value: string) => {
      if (ultrathinkPromptControlled) return;
      if (!value) return;
      const nextOption = effortLevels.find((option) => option.value === value);
      if (!nextOption) return;
      if (promptInjectedValues.includes(nextOption.value)) {
        const nextPrompt =
          prompt.trim().length === 0
            ? ULTRATHINK_PROMPT_PREFIX
            : applyClaudePromptEffortPrefix(prompt, "ultrathink");
        onPromptChange(nextPrompt);
        onSelectionComplete?.();
        return;
      }
      const optionId =
        primarySelectDescriptor?.id ??
        (provider === "kilo" || provider === "opencode"
          ? "variant"
          : provider === "pi"
            ? "thinkingLevel"
            : provider === "claudeAgent"
              ? "effort"
              : "reasoningEffort");
      commitTrait(buildProviderOptionPatch(provider, optionId, nextOption.value));
    },
    [
      ultrathinkPromptControlled,
      effortLevels,
      prompt,
      promptInjectedValues,
      provider,
      primarySelectDescriptor?.id,
      onPromptChange,
      onSelectionComplete,
      commitTrait,
    ],
  );

  if (!hasVisibleControls && !hasAgentControls) return null;

  return (
    <>
      {thinkingEnabled !== null ? (
        <TraitRadioSection
          label="Thinking"
          value={thinkingEnabled ? "on" : "off"}
          options={[
            { value: "on", label: "On (default)" },
            { value: "off", label: "Off" },
          ]}
          onValueChange={(value) => commitTrait({ thinking: value === "on" })}
          onSelectionComplete={onSelectionComplete}
        />
      ) : null}
      {contextWindowOptions.length > 1 ? (
        <>
          {hasPriorContextWindowSection ? <MenuDivider /> : null}
          <TraitRadioSection
            label={contextWindowDescriptor?.label ?? "Context"}
            value={contextWindow ?? defaultContextWindow ?? ""}
            options={contextWindowOptions.map((option) => ({
              value: option.value,
              label: option.label,
              isDefault: option.value === defaultContextWindow,
            }))}
            onValueChange={(value) =>
              commitTrait({ [contextWindowDescriptor?.id ?? "contextWindow"]: value })
            }
            onSelectionComplete={onSelectionComplete}
          />
        </>
      ) : null}
      {effortLevels.length > 0 ? (
        <>
          {hasPriorEffortSection ? <MenuDivider /> : null}
          <TraitRadioSection
            label={provider === "kilo" || provider === "opencode" ? "Variant" : "Effort"}
            note={
              ultrathinkPromptControlled ? (
                <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
                  Remove Ultrathink from the prompt to change effort.
                </div>
              ) : undefined
            }
            value={effort ?? ""}
            disabled={ultrathinkPromptControlled}
            options={effortLevels.map((option) => ({
              value: option.value,
              label: option.label,
              isDefault: option.value === defaultEffort,
              description: option.description ?? null,
            }))}
            onValueChange={handleEffortChange}
            onSelectionComplete={onSelectionComplete}
          />
        </>
      ) : null}
      {includeFastMode && supportsFastModeControl ? (
        <>
          {hasPriorFastModeSection ? <MenuDivider /> : null}
          <TraitRadioSection
            label="Speed"
            value={fastModeEnabled ? "on" : "off"}
            options={[
              { value: "off", label: "Default" },
              { value: "on", label: "Fast" },
            ]}
            onValueChange={(value) => commitTrait({ fastMode: value === "on" })}
            onSelectionComplete={onSelectionComplete}
          />
        </>
      ) : null}
      {hasAgentControls ? (
        <>
          {hasVisibleControls ? <MenuDivider /> : null}
          <TraitRadioSection
            label={provider === "kilo" ? "Mode" : "Agent"}
            value={selectedAgent ?? defaultAgent ?? ""}
            options={agentOptions.map((agent) => ({
              value: agent.name,
              label: agent.displayName,
              isDefault: agent.name === defaultAgent,
              description: agent.description ?? null,
            }))}
            onValueChange={(value) => {
              if (!value || !defaultAgent) return;
              commitTrait({ agent: value === defaultAgent ? undefined : value });
            }}
            onSelectionComplete={onSelectionComplete}
          />
        </>
      ) : null}
    </>
  );
});
