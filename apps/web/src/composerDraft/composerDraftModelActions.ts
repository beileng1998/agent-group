// FILE: composerDraftModelActions.ts
// Purpose: Own sticky, provider-scoped model, runtime, and interaction actions.
// Layer: Web composer action slice

import type { ModelSelection, ProviderKind } from "@agent-group/contracts";
import { getDefaultModel, normalizeModelSlug } from "@agent-group/shared/model";
import * as Equal from "effect/Equal";
import { buildModelSelection } from "../providerModelOptions";
import { createEmptyThreadDraft, shouldRemoveDraft } from "./composerDraftContentState";
import {
  COMPOSER_PROVIDER_KINDS,
  makeModelSelection,
  normalizeModelSelection,
  normalizeProviderKind,
  normalizeProviderModelOptions,
} from "./composerDraftModelCodec";
import {
  reconcileProviderScopedModelSelection,
  stripNonStickyModelOptions,
} from "./composerDraftModelState";
import type {
  ComposerDraftStoreGet,
  ComposerDraftStoreSet,
  ComposerDraftStoreState,
  ComposerThreadDraftState,
} from "./composerDraftState";

type ComposerDraftModelActions = Pick<
  ComposerDraftStoreState,
  | "setStickyModelSelection"
  | "applyStickyState"
  | "setModelSelection"
  | "setModelSelectionAndSticky"
  | "setModelOptions"
  | "setProviderModelOptions"
  | "setRuntimeMode"
  | "setInteractionMode"
>;

export function createComposerDraftModelActions(
  set: ComposerDraftStoreSet,
  get: ComposerDraftStoreGet,
): ComposerDraftModelActions {
  return {
    setStickyModelSelection: (modelSelection) => {
      const rawNormalized = normalizeModelSelection(modelSelection);
      const normalized = rawNormalized ? stripNonStickyModelOptions(rawNormalized) : null;
      set((state) => {
        if (!normalized) {
          return state;
        }
        const nextMap: Partial<Record<ProviderKind, ModelSelection>> = {
          ...state.stickyModelSelectionByProvider,
          [normalized.provider]: normalized,
        };
        if (Equal.equals(state.stickyModelSelectionByProvider, nextMap)) {
          return state.stickyActiveProvider === normalized.provider
            ? state
            : { stickyActiveProvider: normalized.provider };
        }
        return {
          stickyModelSelectionByProvider: nextMap,
          stickyActiveProvider: normalized.provider,
        };
      });
    },
    applyStickyState: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const stickyMap = state.stickyModelSelectionByProvider;
        const stickyActiveProvider = state.stickyActiveProvider;
        if (Object.keys(stickyMap).length === 0 && stickyActiveProvider === null) {
          return state;
        }
        const existing = state.draftsByThreadId[threadId];
        const base = existing ?? createEmptyThreadDraft();
        const nextMap = { ...base.modelSelectionByProvider };
        for (const [provider, selection] of Object.entries(stickyMap)) {
          if (selection) {
            const current = nextMap[provider as ProviderKind];
            nextMap[provider as ProviderKind] =
              current && current.model !== selection.model ? current : selection;
          }
        }
        if (
          Equal.equals(base.modelSelectionByProvider, nextMap) &&
          base.activeProvider === stickyActiveProvider
        ) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          modelSelectionByProvider: nextMap,
          activeProvider: stickyActiveProvider,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) {
          delete nextDraftsByThreadId[threadId];
        } else {
          nextDraftsByThreadId[threadId] = nextDraft;
        }
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    setModelSelection: (threadId, modelSelection) => {
      if (threadId.length === 0) {
        return;
      }
      const normalized = normalizeModelSelection(modelSelection);
      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        if (!existing && normalized === null) {
          return state;
        }
        const base = existing ?? createEmptyThreadDraft();
        const nextMap = { ...base.modelSelectionByProvider };
        if (normalized) {
          const current = nextMap[normalized.provider];
          nextMap[normalized.provider] = reconcileProviderScopedModelSelection(normalized, current);
        }
        const nextActiveProvider = normalized?.provider ?? base.activeProvider;
        if (
          Equal.equals(base.modelSelectionByProvider, nextMap) &&
          base.activeProvider === nextActiveProvider
        ) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          modelSelectionByProvider: nextMap,
          activeProvider: nextActiveProvider,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) {
          delete nextDraftsByThreadId[threadId];
        } else {
          nextDraftsByThreadId[threadId] = nextDraft;
        }
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    setModelSelectionAndSticky: (threadId, modelSelection) => {
      get().setModelSelection(threadId, modelSelection);
      const correctedSelection =
        get().draftsByThreadId[threadId]?.modelSelectionByProvider[modelSelection.provider];
      get().setStickyModelSelection(correctedSelection ?? modelSelection);
    },
    setModelOptions: (threadId, modelOptions) => {
      if (threadId.length === 0) {
        return;
      }
      const normalizedOpts = normalizeProviderModelOptions(modelOptions);
      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        if (!existing && normalizedOpts === null) {
          return state;
        }
        const base = existing ?? createEmptyThreadDraft();
        const nextMap = { ...base.modelSelectionByProvider };
        for (const provider of COMPOSER_PROVIDER_KINDS) {
          // Only touch providers explicitly present in the input
          if (!normalizedOpts || !(provider in normalizedOpts)) continue;
          const opts = normalizedOpts[provider];
          const current = nextMap[provider];
          if (opts) {
            const model = current?.model ?? getDefaultModel(provider);
            if (!model) continue;
            nextMap[provider] = makeModelSelection(provider, model, opts);
          } else if (current?.options) {
            // Remove options but keep the selection
            nextMap[provider] = buildModelSelection(provider, current.model);
          }
        }
        if (Equal.equals(base.modelSelectionByProvider, nextMap)) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          modelSelectionByProvider: nextMap,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) {
          delete nextDraftsByThreadId[threadId];
        } else {
          nextDraftsByThreadId[threadId] = nextDraft;
        }
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    setProviderModelOptions: (threadId, provider, nextProviderOptions, options) => {
      if (threadId.length === 0) {
        return;
      }
      const normalizedProvider = normalizeProviderKind(provider);
      if (normalizedProvider === null) {
        return;
      }
      // Normalize just this provider's options
      const normalizedOpts = normalizeProviderModelOptions(
        { [normalizedProvider]: nextProviderOptions },
        normalizedProvider,
      );
      const providerOpts = normalizedOpts?.[normalizedProvider];
      const fallbackModel =
        normalizeModelSlug(options?.model, normalizedProvider) ??
        getDefaultModel(normalizedProvider);

      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        const base = existing ?? createEmptyThreadDraft();

        // Update the map entry for this provider
        const nextMap = { ...base.modelSelectionByProvider };
        const currentForProvider = nextMap[normalizedProvider];
        if (providerOpts) {
          const nextModel = currentForProvider?.model ?? fallbackModel;
          if (!nextModel) {
            return state;
          }
          nextMap[normalizedProvider] = makeModelSelection(
            normalizedProvider,
            nextModel,
            providerOpts,
          );
        } else if (currentForProvider?.options) {
          nextMap[normalizedProvider] = buildModelSelection(
            normalizedProvider,
            currentForProvider.model,
          );
        }

        // Handle sticky persistence
        let nextStickyMap = state.stickyModelSelectionByProvider;
        let nextStickyActiveProvider = state.stickyActiveProvider;
        if (options?.persistSticky === true) {
          nextStickyMap = { ...state.stickyModelSelectionByProvider };
          const stickyBase =
            nextStickyMap[normalizedProvider] ??
            base.modelSelectionByProvider[normalizedProvider] ??
            (fallbackModel ? makeModelSelection(normalizedProvider, fallbackModel) : null);
          if (!stickyBase) {
            return state;
          }
          if (providerOpts) {
            nextStickyMap[normalizedProvider] = stripNonStickyModelOptions(
              makeModelSelection(normalizedProvider, stickyBase.model, providerOpts),
            );
          } else if (stickyBase.options) {
            nextStickyMap[normalizedProvider] = buildModelSelection(
              normalizedProvider,
              stickyBase.model,
            );
          }
          nextStickyActiveProvider = base.activeProvider ?? normalizedProvider;
        }

        if (
          Equal.equals(base.modelSelectionByProvider, nextMap) &&
          Equal.equals(state.stickyModelSelectionByProvider, nextStickyMap) &&
          state.stickyActiveProvider === nextStickyActiveProvider
        ) {
          return state;
        }

        const nextDraft: ComposerThreadDraftState = {
          ...base,
          modelSelectionByProvider: nextMap,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) {
          delete nextDraftsByThreadId[threadId];
        } else {
          nextDraftsByThreadId[threadId] = nextDraft;
        }

        return {
          draftsByThreadId: nextDraftsByThreadId,
          ...(options?.persistSticky === true
            ? {
                stickyModelSelectionByProvider: nextStickyMap,
                stickyActiveProvider: nextStickyActiveProvider,
              }
            : {}),
        };
      });
    },
    setRuntimeMode: (threadId, runtimeMode) => {
      if (threadId.length === 0) {
        return;
      }
      const nextRuntimeMode =
        runtimeMode === "approval-required" || runtimeMode === "full-access" ? runtimeMode : null;
      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        if (!existing && nextRuntimeMode === null) {
          return state;
        }
        const base = existing ?? createEmptyThreadDraft();
        if (base.runtimeMode === nextRuntimeMode) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          runtimeMode: nextRuntimeMode,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) {
          delete nextDraftsByThreadId[threadId];
        } else {
          nextDraftsByThreadId[threadId] = nextDraft;
        }
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    setInteractionMode: (threadId, interactionMode) => {
      if (threadId.length === 0) {
        return;
      }
      const nextInteractionMode =
        interactionMode === "plan" || interactionMode === "default" ? interactionMode : null;
      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        if (!existing && nextInteractionMode === null) {
          return state;
        }
        const base = existing ?? createEmptyThreadDraft();
        if (base.interactionMode === nextInteractionMode) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          interactionMode: nextInteractionMode,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) {
          delete nextDraftsByThreadId[threadId];
        } else {
          nextDraftsByThreadId[threadId] = nextDraft;
        }
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    // Keep queued follow-ups with the thread draft so route changes do not hide them.
  };
}
