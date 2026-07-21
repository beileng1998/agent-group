// FILE: useComposerRuntimeTraitsController.ts
// Purpose: Own composer runtime traits, context-window presentation, and fast mode.
// Layer: Web composer controller

import {
  type ProviderAgentDescriptor,
  type ProviderKind,
  type ProviderModelDescriptor,
  type ProviderModelOptions,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback, useMemo } from "react";

import type { ComposerDraftStoreState } from "../composerDraftStore";
import { getComposerTraitSelection } from "../components/chat/composerTraits";
import { resolveTraitsTriggerSummary } from "../components/chat/TraitsPicker";
import {
  deriveContextWindowSelectionStatus,
  deriveSelectedContextWindowSnapshot,
  type ContextWindowSnapshot,
} from "../lib/contextWindow";
import { buildNextProviderOptions } from "../providerModelOptions";

export function useComposerRuntimeTraitsController(input: {
  threadId: ThreadId;
  provider: ProviderKind;
  selectedModel: string;
  pickerModel: string;
  prompt: string;
  modelOptions: ProviderModelOptions | null;
  runtimeModel: ProviderModelDescriptor | undefined;
  runtimeAgents: ReadonlyArray<ProviderAgentDescriptor>;
  activeContextWindow: ContextWindowSnapshot | null;
  persistProviderOptions: ComposerDraftStoreState["setProviderModelOptions"];
  focus: () => void;
}) {
  const selectedProviderModelOptions = input.modelOptions?.[input.provider];
  const traitSelection = getComposerTraitSelection(
    input.provider,
    input.selectedModel,
    input.prompt,
    selectedProviderModelOptions,
    input.runtimeModel,
  );
  const runtimeUsageContextWindow = useMemo(
    () =>
      input.activeContextWindow ??
      (input.provider === "claudeAgent"
        ? deriveSelectedContextWindowSnapshot(traitSelection.contextWindow)
        : null),
    [input.activeContextWindow, input.provider, traitSelection.contextWindow],
  );
  const contextWindowSelectionStatus = useMemo(
    () =>
      deriveContextWindowSelectionStatus({
        activeSnapshot: runtimeUsageContextWindow,
        selectedValue: input.provider === "claudeAgent" ? traitSelection.contextWindow : null,
      }),
    [input.provider, runtimeUsageContextWindow, traitSelection.contextWindow],
  );
  const footerTraitsSummary = resolveTraitsTriggerSummary({
    provider: input.provider,
    model: input.pickerModel,
    prompt: input.prompt,
    modelOptions: selectedProviderModelOptions,
    ...(input.runtimeModel ? { runtimeModel: input.runtimeModel } : {}),
    runtimeAgents: input.runtimeAgents,
  });
  const toggleFastMode = useCallback(() => {
    if (!traitSelection.caps.supportsFastMode) {
      input.focus();
      return;
    }
    input.persistProviderOptions(
      input.threadId,
      input.provider,
      buildNextProviderOptions(input.provider, selectedProviderModelOptions, {
        fastMode: !traitSelection.fastModeEnabled,
      }),
      { persistSticky: true },
    );
    input.focus();
  }, [
    input.focus,
    input.persistProviderOptions,
    input.provider,
    input.threadId,
    selectedProviderModelOptions,
    traitSelection.caps.supportsFastMode,
    traitSelection.fastModeEnabled,
  ]);

  return {
    contextWindowSelectionStatus,
    footerTraitsSummary,
    runtimeUsageContextWindow,
    selectedProviderModelOptions,
    toggleFastMode,
    traitSelection,
  };
}
