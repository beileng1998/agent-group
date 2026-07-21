// FILE: useComposerProviderModelState.ts
// Purpose: Build the composer provider/model read model and dispatch selection.
// Layer: Web composer read-model controller

import { type ModelSelection, type ProviderKind, type ThreadId } from "@agent-group/contracts";
import { normalizeModelSlug } from "@agent-group/shared/model";
import { useMemo } from "react";

import { getProviderStartOptions, type AppSettings } from "../appSettings";
import {
  type ComposerThreadDraftState,
  useEffectiveComposerModelState,
} from "../composerDraftStore";
import { shouldShowComposerModelBootstrapSkeleton } from "../components/ChatView.environmentModel";
import { AVAILABLE_PROVIDER_OPTIONS } from "../components/chat/ProviderModelPicker";
import { getComposerProviderState } from "../components/chat/composerProviderRegistry";
import { resolveRuntimeModelDescriptor } from "../components/chat/runtimeModelCapabilities";
import { resolveProviderDiscoveryCwd } from "../lib/providerDiscovery";
import { compareProvidersByOrder } from "../providerOrdering";
import { buildModelSelection } from "../providerModelOptions";
import { useProviderModelCatalog } from "./useProviderModelCatalog";

export function useComposerProviderModelState(input: {
  threadId: ThreadId;
  prompt: string;
  draft: ComposerThreadDraftState;
  threadModelSelection: ModelSelection | null;
  projectModelSelection: ModelSelection | null;
  sessionProvider: ProviderKind | null;
  threadStarted: boolean;
  threadWorktreePath: string | null;
  projectCwd: string | null;
  serverCwd: string | null;
  pickerOpen: boolean;
  settings: AppSettings;
}) {
  const lockedProvider: ProviderKind | null = null;
  const selectedProvider: ProviderKind =
    input.draft.activeProvider ??
    input.threadModelSelection?.provider ??
    input.projectModelSelection?.provider ??
    input.sessionProvider ??
    input.settings.defaultProvider;

  const modelHintByProvider = useMemo<Record<ProviderKind, string | null>>(() => {
    const resolveHint = (provider: ProviderKind): string | null =>
      input.draft.modelSelectionByProvider[provider]?.model ??
      (input.threadModelSelection?.provider === provider
        ? input.threadModelSelection.model
        : null) ??
      (input.projectModelSelection?.provider === provider
        ? input.projectModelSelection.model
        : null);
    return {
      codex: resolveHint("codex"),
      claudeAgent: resolveHint("claudeAgent"),
      cursor: resolveHint("cursor"),
      antigravity: resolveHint("antigravity"),
      grok: resolveHint("grok"),
      droid: resolveHint("droid"),
      kilo: resolveHint("kilo"),
      opencode: resolveHint("opencode"),
      pi: resolveHint("pi"),
    };
  }, [
    input.draft.modelSelectionByProvider,
    input.projectModelSelection,
    input.threadModelSelection,
  ]);

  const discoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: input.threadWorktreePath,
    activeProjectCwd: input.projectCwd,
    serverCwd: input.serverCwd,
  });
  const catalog = useProviderModelCatalog({
    selectedProvider,
    lockedProvider,
    discoveryEnabled: input.pickerOpen,
    cwd: discoveryCwd,
    modelHintByProvider,
    prefetchCoreAgents: true,
  });
  const effectiveModel = useEffectiveComposerModelState({
    threadId: input.threadId,
    selectedProvider,
    threadModelSelection: input.threadModelSelection ?? undefined,
    projectModelSelection: input.projectModelSelection ?? undefined,
    customModelsByProvider: catalog.customModelsByProvider,
    availableModelOptionsByProvider: catalog.modelOptionsByProvider,
  });
  const selectedRuntimeModel = useMemo(
    () =>
      resolveRuntimeModelDescriptor({
        provider: selectedProvider,
        model: effectiveModel.selectedModel,
        runtimeModels: catalog.runtimeModelsByProvider[selectedProvider],
      }),
    [catalog.runtimeModelsByProvider, effectiveModel.selectedModel, selectedProvider],
  );
  const composerProviderState = useMemo(
    () =>
      getComposerProviderState({
        provider: selectedProvider,
        model: effectiveModel.selectedModel,
        runtimeModel: selectedRuntimeModel,
        prompt: input.prompt,
        modelOptions: effectiveModel.modelOptions,
      }),
    [
      effectiveModel.modelOptions,
      effectiveModel.selectedModel,
      input.prompt,
      selectedProvider,
      selectedRuntimeModel,
    ],
  );
  const draftSelection = input.draft.modelSelectionByProvider[selectedProvider] ?? null;
  const selectedModelSelection = useMemo<ModelSelection>(() => {
    if (selectedProvider === "pi" && draftSelection?.provider === "pi") {
      return buildModelSelection(
        selectedProvider,
        draftSelection.model,
        composerProviderState.modelOptionsForDispatch ?? draftSelection.options,
      );
    }
    return buildModelSelection(
      selectedProvider,
      effectiveModel.selectedModel,
      composerProviderState.modelOptionsForDispatch,
    );
  }, [
    composerProviderState.modelOptionsForDispatch,
    draftSelection,
    effectiveModel.selectedModel,
    selectedProvider,
  ]);
  const selectedModelForPicker =
    selectedModelSelection.provider === selectedProvider
      ? selectedModelSelection.model
      : effectiveModel.selectedModel;
  const selectedModelForPickerWithCustomFallback = useMemo(() => {
    const options = catalog.modelOptionsByProvider[selectedProvider];
    return options.some((option) => option.slug === selectedModelForPicker)
      ? selectedModelForPicker
      : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
  }, [catalog.modelOptionsByProvider, selectedModelForPicker, selectedProvider]);
  const persistedSelection =
    input.sessionProvider && input.threadModelSelection?.provider !== input.sessionProvider
      ? input.projectModelSelection?.provider === selectedProvider
        ? input.projectModelSelection
        : null
      : (input.threadModelSelection ?? input.projectModelSelection);
  const showBootstrapSkeleton = shouldShowComposerModelBootstrapSkeleton({
    selectedProvider,
    selectedModel: effectiveModel.selectedModel,
    persistedModelSelection: persistedSelection,
    draftModelSelection: draftSelection,
    providerModelsLoading: catalog.providerModelsLoading,
    requiresDiscoveredModels: catalog.selectedProviderRequiresRuntimeModels,
  });
  const searchableModelOptions = useMemo(
    () =>
      AVAILABLE_PROVIDER_OPTIONS.toSorted((left, right) =>
        compareProvidersByOrder(input.settings.providerOrder, left.value, right.value),
      )
        .filter((option) => option.value.length > 0)
        .flatMap((option) =>
          catalog.modelOptionsByProvider[option.value].map(
            ({ slug, name, upstreamProviderId, upstreamProviderName }) => ({
              provider: option.value,
              providerLabel: option.label,
              slug,
              name,
              searchSlug: slug.toLowerCase(),
              searchName: name.toLowerCase(),
              searchProvider: option.label.toLowerCase(),
              searchUpstreamProvider: (
                upstreamProviderName ??
                upstreamProviderId ??
                ""
              ).toLowerCase(),
            }),
          ),
        ),
    [catalog.modelOptionsByProvider, input.settings.providerOrder],
  );
  const providerOptionsForDispatch = useMemo(
    () => getProviderStartOptions(input.settings),
    [input.settings],
  );

  return {
    catalog,
    composerProviderState,
    discoveryCwd,
    hasThreadStarted: input.threadStarted,
    lockedProvider,
    providerOptionsForDispatch,
    searchableModelOptions,
    selectedModel: effectiveModel.selectedModel,
    selectedModelForPickerWithCustomFallback,
    selectedModelOptions: effectiveModel.modelOptions,
    selectedModelSelection,
    selectedPromptEffort: composerProviderState.promptEffort,
    selectedProvider,
    selectedRuntimeModel,
    showBootstrapSkeleton,
  };
}
