// FILE: composerDraftModelState.ts
// Purpose: Reconcile provider-scoped selections, sticky state, and effective models.
// Layer: Web composer model state

import type {
  ModelSelection,
  ModelSlug,
  ProviderKind,
  ProviderModelOptions,
} from "@agent-group/contracts";
import {
  getDefaultModel,
  normalizeModelSlug,
  resolveModelSlugForProvider,
  resolveSelectableModel,
} from "@agent-group/shared/model";
import { resolveAppModelSelection } from "../appSettings";
import { classifyProviderReasoningEffortSupport } from "../lib/codexReasoningEffort";
import {
  COMPOSER_PROVIDER_KINDS,
  makeModelSelection,
  normalizeProviderModelOptions,
} from "./composerDraftModelCodec";
import type { ComposerThreadDraftState, EffectiveComposerModelState } from "./composerDraftState";

export function mergeProviderModelOptionsFromSelections(
  ...selections: ReadonlyArray<ModelSelection | null | undefined>
): ProviderModelOptions | null {
  const result: Partial<Record<ProviderKind, ProviderModelOptions[ProviderKind]>> = {};
  for (const selection of selections) {
    if (!selection) continue;
    if (selection.options) {
      result[selection.provider] = selection.options;
    } else {
      delete result[selection.provider];
    }
  }
  return Object.keys(result).length > 0 ? (result as ProviderModelOptions) : null;
}

export function deriveEffectiveComposerModelOptions(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
}): ProviderModelOptions | null {
  const baseOptions = mergeProviderModelOptionsFromSelections(
    input.projectModelSelection,
    input.threadModelSelection,
  );
  const draftSelections = input.draft?.modelSelectionByProvider;
  if (!draftSelections) {
    return baseOptions;
  }

  const result: Partial<Record<ProviderKind, ProviderModelOptions[ProviderKind]>> = baseOptions
    ? { ...baseOptions }
    : {};
  for (const [provider, selection] of Object.entries(draftSelections) as Array<
    [ProviderKind, ModelSelection | undefined]
  >) {
    if (!selection) continue;
    if (selection.options) {
      result[provider] = selection.options;
    } else {
      delete result[provider];
    }
  }
  return Object.keys(result).length > 0 ? (result as ProviderModelOptions) : null;
}

export function reconcileProviderScopedModelSelection(
  requested: ModelSelection,
  current: ModelSelection | null | undefined,
): ModelSelection {
  if (requested.options !== undefined || current?.provider !== requested.provider) {
    return requested;
  }
  if (current.model === requested.model) {
    return makeModelSelection(requested.provider, requested.model, current.options);
  }
  if (
    current.provider !== "codex" &&
    current.provider !== "cursor" &&
    current.provider !== "claudeAgent"
  ) {
    return requested;
  }
  let preservedOptions = current.options;
  const effort =
    current.provider === "claudeAgent"
      ? current.options?.effort
      : current.provider === "codex" || current.provider === "cursor"
        ? current.options?.reasoningEffort
        : undefined;
  if (
    effort !== undefined &&
    classifyProviderReasoningEffortSupport({
      provider: requested.provider,
      model: requested.model,
      effort,
    }) !== "supported"
  ) {
    if (current.provider === "claudeAgent") {
      const { effort: _effort, ...remainingOptions } = current.options ?? {};
      preservedOptions = Object.keys(remainingOptions).length > 0 ? remainingOptions : undefined;
    } else if (current.provider === "codex" || current.provider === "cursor") {
      const { reasoningEffort: _reasoningEffort, ...remainingOptions } = current.options ?? {};
      preservedOptions = Object.keys(remainingOptions).length > 0 ? remainingOptions : undefined;
    }
  }
  return makeModelSelection(requested.provider, requested.model, preservedOptions);
}

// ── Sticky selection sanitization ─────────────────────────────────────

// The Claude context window must stay a per-thread choice: a 1M thread can grow far
// beyond the normal 200k compaction point and consume usage limits much faster, so a
// one-off pick must never silently become every future thread's sticky default.
export function stripNonStickyModelOptions(selection: ModelSelection): ModelSelection {
  if (
    selection.provider !== "claudeAgent" ||
    (!selection.options?.contextWindow && !selection.options?.autoCompactWindow)
  ) {
    return selection;
  }
  const {
    contextWindow: _contextWindow,
    autoCompactWindow: _autoCompactWindow,
    ...rest
  } = selection.options;
  return makeModelSelection(
    selection.provider,
    selection.model,
    Object.keys(rest).length > 0 ? rest : undefined,
  );
}

export function sanitizeStickyModelSelectionMap(
  map: Partial<Record<ProviderKind, ModelSelection>>,
): Partial<Record<ProviderKind, ModelSelection>> {
  const claude = map.claudeAgent;
  if (
    claude?.provider !== "claudeAgent" ||
    (!claude.options?.contextWindow && !claude.options?.autoCompactWindow)
  ) {
    return map;
  }
  return { ...map, claudeAgent: stripNonStickyModelOptions(claude) };
}

// ── Legacy sync helpers (used only during migration from v2 storage) ──

export function legacySyncModelSelectionOptions(
  modelSelection: ModelSelection | null,
  modelOptions: ProviderModelOptions | null | undefined,
): ModelSelection | null {
  if (modelSelection === null) {
    return null;
  }
  const options = modelOptions?.[modelSelection.provider];
  return makeModelSelection(modelSelection.provider, modelSelection.model, options);
}

export function legacyMergeModelSelectionIntoProviderModelOptions(
  modelSelection: ModelSelection | null,
  currentModelOptions: ProviderModelOptions | null | undefined,
): ProviderModelOptions | null {
  if (modelSelection?.options === undefined) {
    return normalizeProviderModelOptions(currentModelOptions);
  }
  return legacyReplaceProviderModelOptions(
    normalizeProviderModelOptions(currentModelOptions),
    modelSelection.provider,
    modelSelection.options,
  );
}

export function legacyReplaceProviderModelOptions(
  currentModelOptions: ProviderModelOptions | null | undefined,
  provider: ProviderKind,
  nextProviderOptions: ProviderModelOptions[ProviderKind] | null | undefined,
): ProviderModelOptions | null {
  const { [provider]: _discardedProviderModelOptions, ...otherProviderModelOptions } =
    currentModelOptions ?? {};
  const normalizedNextProviderOptions = normalizeProviderModelOptions(
    { [provider]: nextProviderOptions },
    provider,
  );

  return normalizeProviderModelOptions({
    ...otherProviderModelOptions,
    ...(normalizedNextProviderOptions ? normalizedNextProviderOptions : {}),
  });
}

// ── New helpers for the consolidated representation ────────────────────

export function legacyToModelSelectionByProvider(
  modelSelection: ModelSelection | null,
  modelOptions: ProviderModelOptions | null | undefined,
): Partial<Record<ProviderKind, ModelSelection>> {
  const result: Partial<Record<ProviderKind, ModelSelection>> = {};
  // Add entries from the options bag (for non-active providers)
  if (modelOptions) {
    for (const provider of COMPOSER_PROVIDER_KINDS) {
      const options = modelOptions[provider];
      if (options && Object.keys(options).length > 0) {
        const model =
          modelSelection?.provider === provider ? modelSelection.model : getDefaultModel(provider);
        if (model) {
          result[provider] = makeModelSelection(provider, model, options);
        }
      }
    }
  }
  // Add/overwrite the active selection (it's authoritative for its provider)
  if (modelSelection) {
    result[modelSelection.provider] = modelSelection;
  }
  return result;
}

export function deriveEffectiveComposerModelState(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  selectedProvider: ProviderKind;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  customModelsByProvider: Record<ProviderKind, readonly string[]>;
  availableModelOptionsByProvider?: Partial<
    Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>
  >;
}): EffectiveComposerModelState {
  const resolveAvailableModel = (candidate: string | null | undefined): ModelSlug | null => {
    const availableOptions = input.availableModelOptionsByProvider?.[input.selectedProvider];
    if (!availableOptions || availableOptions.length === 0) {
      return null;
    }
    return resolveSelectableModel(input.selectedProvider, candidate, availableOptions);
  };
  const baseModel = resolveModelSlugForProvider(
    input.selectedProvider,
    (input.threadModelSelection?.provider === input.selectedProvider
      ? input.threadModelSelection.model
      : null) ??
      (input.projectModelSelection?.provider === input.selectedProvider
        ? input.projectModelSelection.model
        : null) ??
      getDefaultModel(input.selectedProvider),
  );
  const persistedThreadModel =
    input.threadModelSelection?.provider === input.selectedProvider
      ? (normalizeModelSlug(input.threadModelSelection.model, input.selectedProvider) ??
        input.threadModelSelection.model)
      : null;
  const persistedProjectModel =
    input.projectModelSelection?.provider === input.selectedProvider
      ? (normalizeModelSlug(input.projectModelSelection.model, input.selectedProvider) ??
        input.projectModelSelection.model)
      : null;
  const activeSelection = input.draft?.modelSelectionByProvider?.[input.selectedProvider];
  const selectedDraftModel = activeSelection?.model
    ? resolveAppModelSelection(
        input.selectedProvider,
        input.customModelsByProvider,
        activeSelection.model,
      )
    : null;
  const unlistedDraftModel = input.selectedProvider === "pi" ? selectedDraftModel : null;
  const selectedModel =
    resolveAvailableModel(activeSelection?.model) ??
    resolveAvailableModel(
      input.threadModelSelection?.provider === input.selectedProvider
        ? input.threadModelSelection.model
        : null,
    ) ??
    resolveAvailableModel(
      input.projectModelSelection?.provider === input.selectedProvider
        ? input.projectModelSelection.model
        : null,
    ) ??
    resolveAvailableModel(selectedDraftModel) ??
    persistedThreadModel ??
    persistedProjectModel ??
    unlistedDraftModel ??
    input.availableModelOptionsByProvider?.[input.selectedProvider]?.[0]?.slug ??
    selectedDraftModel ??
    baseModel ??
    getDefaultModel("codex");
  const modelOptions = deriveEffectiveComposerModelOptions(input);

  return {
    selectedModel,
    modelOptions,
  };
}

// Resolve the model we should persist for a draft-backed thread promotion.
// This keeps terminal-first thread creation aligned with the composer precedence.
export function resolvePreferredComposerModelSelection(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  defaultProvider?: ProviderKind | null | undefined;
}): ModelSelection {
  const draftProviderWithSelection =
    COMPOSER_PROVIDER_KINDS.find(
      (provider) => input.draft?.modelSelectionByProvider?.[provider] !== undefined,
    ) ?? null;
  const preferredProvider =
    input.draft?.activeProvider ??
    draftProviderWithSelection ??
    input.threadModelSelection?.provider ??
    input.projectModelSelection?.provider ??
    input.defaultProvider ??
    "codex";

  return (
    input.draft?.modelSelectionByProvider?.[preferredProvider] ??
    (input.threadModelSelection?.provider === preferredProvider
      ? input.threadModelSelection
      : null) ??
    (input.projectModelSelection?.provider === preferredProvider
      ? input.projectModelSelection
      : null) ?? {
      provider: preferredProvider === "pi" ? "codex" : preferredProvider,
      model: getDefaultModel(preferredProvider === "pi" ? "codex" : preferredProvider),
    }
  );
}
