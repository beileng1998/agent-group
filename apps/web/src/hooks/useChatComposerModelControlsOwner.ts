// FILE: useChatComposerModelControlsOwner.ts
// Purpose: Own the composer's runtime traits, footer degradation, and model controls read model.
// Layer: Web chat composer owner

import {
  type ModelSlug,
  type ProviderAgentDescriptor,
  type ProviderKind,
  type ProviderModelDescriptor,
  type ProviderModelOptions,
  type ServerProviderStatus,
  type ThreadId,
} from "@agent-group/contracts";
import { useLayoutEffect, useMemo } from "react";

import type { ComposerDraftStoreState } from "../composerDraftStore";
import { composerFooterPlanForTier } from "../components/composerFooterLayout";
import type { ComposerModelControlsModel } from "../components/chat/ComposerModelControls";
import { EMPTY_HIDDEN_PROVIDERS } from "../components/chat/chatViewProviderValues";
import { resolveProviderModelLabel } from "../components/chat/ProviderModelPicker";
import type { ContextWindowSnapshot } from "../lib/contextWindow";
import type { ProviderModelOption } from "../providerModelOptions";
import { useComposerRuntimeTraitsController } from "./useComposerRuntimeTraitsController";

export interface UseChatComposerModelControlsOwnerInput {
  provider: {
    selected: ProviderKind;
    selectedModel: string;
    pickerModel: ModelSlug;
    locked: ProviderKind | null;
    statuses: ReadonlyArray<ServerProviderStatus>;
    modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
    loadingModelProviders: Partial<Record<ProviderKind, boolean>>;
    order: ReadonlyArray<ProviderKind>;
  };
  runtime: {
    threadId: ThreadId;
    prompt: string;
    modelOptions: ProviderModelOptions | null;
    selectedModel: ProviderModelDescriptor | undefined;
    models: ReadonlyArray<ProviderModelDescriptor> | undefined;
    agents: ReadonlyArray<ProviderAgentDescriptor>;
    activeContextWindow: ContextWindowSnapshot | null;
  };
  layout: {
    footerTier: number;
    compact: boolean;
    isLocalDraftThread: boolean;
    hasThreadStarted: boolean;
    showBootstrapSkeleton: boolean;
    selectedProviderRuntimeModelDiscoveryPending: boolean;
  };
  actions: {
    persistProviderOptions: ComposerDraftStoreState["setProviderModelOptions"];
    focus: () => void;
    resetFooterLayout: () => void;
    onProviderModelSelect: (provider: ProviderKind, model: ModelSlug) => void;
    setPromptFromTraits: (prompt: string) => void;
    modelPicker: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
    };
    traitsPicker: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
    };
    combinedPicker: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
    };
    shortcutLabels: {
      model: string | null;
      traits: string | null;
    };
  };
}

export function useChatComposerModelControlsOwner(input: UseChatComposerModelControlsOwnerInput) {
  const {
    contextWindowSelectionStatus,
    footerTraitsSummary,
    runtimeUsageContextWindow,
    selectedProviderModelOptions,
    toggleFastMode,
    traitSelection: composerTraitSelection,
  } = useComposerRuntimeTraitsController({
    threadId: input.runtime.threadId,
    provider: input.provider.selected,
    selectedModel: input.provider.selectedModel,
    pickerModel: input.provider.pickerModel,
    prompt: input.runtime.prompt,
    modelOptions: input.runtime.modelOptions,
    runtimeModel: input.runtime.selectedModel,
    runtimeAgents: input.runtime.agents,
    activeContextWindow: input.runtime.activeContextWindow,
    persistProviderOptions: input.actions.persistProviderOptions,
    focus: input.actions.focus,
  });

  const useSplitComposerPickerControls =
    input.layout.isLocalDraftThread && !input.layout.hasThreadStarted;
  const footerControlsPlan = useMemo(
    () => composerFooterPlanForTier(input.layout.footerTier, Boolean(runtimeUsageContextWindow)),
    [input.layout.footerTier, runtimeUsageContextWindow],
  );
  const footerModelLabel = resolveProviderModelLabel({
    provider: input.provider.selected,
    lockedProvider: input.provider.locked,
    model: input.provider.pickerModel,
    modelOptionsByProvider: input.provider.modelOptionsByProvider,
  });
  const footerPlanInputsKey = [
    footerModelLabel,
    footerTraitsSummary.summaryText,
    Boolean(runtimeUsageContextWindow),
    useSplitComposerPickerControls,
  ].join(":");

  useLayoutEffect(() => {
    input.actions.resetFooterLayout();
  }, [footerPlanInputsKey, input.actions.resetFooterLayout]);

  const loadingModelProviders = {
    antigravity: input.provider.loadingModelProviders.antigravity ?? false,
    cursor: input.provider.loadingModelProviders.cursor ?? false,
    droid: input.provider.loadingModelProviders.droid ?? false,
    kilo: input.provider.loadingModelProviders.kilo ?? false,
    opencode: input.provider.loadingModelProviders.opencode ?? false,
    pi: input.provider.loadingModelProviders.pi ?? false,
  };
  const sharedModelPickerProps = {
    provider: input.provider.selected,
    model: input.provider.pickerModel,
    lockedProvider: input.provider.locked,
    providers: input.provider.statuses,
    modelOptionsByProvider: input.provider.modelOptionsByProvider,
    loadingModelProviders,
    hiddenProviders: EMPTY_HIDDEN_PROVIDERS,
    providerOrder: input.provider.order,
    onProviderModelChange: input.actions.onProviderModelSelect,
    onSelectionCommitted: input.actions.focus,
    shortcutLabel: input.actions.shortcutLabels.model,
  };
  const sharedTraitsPickerProps = {
    provider: input.provider.selected,
    threadId: input.runtime.threadId,
    model: input.provider.pickerModel,
    runtimeModel: input.runtime.selectedModel,
    runtimeModels: input.runtime.models,
    runtimeAgents: input.runtime.agents,
    modelOptions: selectedProviderModelOptions,
    prompt: input.runtime.prompt,
    onPromptChange: input.actions.setPromptFromTraits,
    onSelectionCommitted: input.actions.focus,
  };

  const modelControlsModel: ComposerModelControlsModel = input.layout.showBootstrapSkeleton
    ? {
        kind: "loading",
        layout: useSplitComposerPickerControls ? "split" : "combined",
        compact: input.layout.compact,
        modelDiscoveryPending: input.layout.selectedProviderRuntimeModelDiscoveryPending,
      }
    : useSplitComposerPickerControls
      ? {
          kind: "split",
          modelPicker: {
            ...sharedModelPickerProps,
            compact: input.layout.compact,
            hideLabel: !footerControlsPlan.showModelLabel,
            open: input.actions.modelPicker.open,
            onOpenChange: input.actions.modelPicker.onOpenChange,
          },
          traitsPicker: {
            ...sharedTraitsPickerProps,
            open: input.actions.traitsPicker.open,
            onOpenChange: input.actions.traitsPicker.onOpenChange,
            shortcutLabel: input.actions.shortcutLabels.traits,
            hideLabel: !footerControlsPlan.showTraitsLabel,
          },
        }
      : {
          kind: "combined",
          picker: {
            ...sharedModelPickerProps,
            ...sharedTraitsPickerProps,
            compact: input.layout.compact,
            hideModelLabel: !footerControlsPlan.showModelLabel,
            hideStatusLabel: !footerControlsPlan.showTraitsLabel,
            open: input.actions.combinedPicker.open,
            onOpenChange: input.actions.combinedPicker.onOpenChange,
          },
        };

  return {
    runtimeUsageContextWindow,
    contextWindowSelectionStatus,
    composerTraitSelection,
    toggleFastMode,
    footerControlsPlan,
    modelControlsModel,
  };
}
