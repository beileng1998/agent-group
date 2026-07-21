// FILE: composerDraftHooks.ts
// Purpose: Expose React selectors and draft-promotion helpers for the composer store.
// Layer: Web composer hooks

import type { ModelSelection, ProviderKind, ThreadId } from "@agent-group/contracts";
import { useMemo } from "react";
import { EMPTY_THREAD_DRAFT } from "./composerDraftContentState";
import { deriveEffectiveComposerModelState } from "./composerDraftModelState";
import type { ComposerThreadDraftState, EffectiveComposerModelState } from "./composerDraftState";
import { useComposerDraftStore } from "./composerDraftStoreRoot";

export function useComposerThreadDraft(threadId: ThreadId): ComposerThreadDraftState {
  return useComposerDraftStore((state) => state.draftsByThreadId[threadId] ?? EMPTY_THREAD_DRAFT);
}

export function useEffectiveComposerModelState(input: {
  threadId: ThreadId;
  selectedProvider: ProviderKind;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  customModelsByProvider: Record<ProviderKind, readonly string[]>;
  availableModelOptionsByProvider?: Partial<
    Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>
  >;
}): EffectiveComposerModelState {
  const draft = useComposerThreadDraft(input.threadId);
  return useMemo(
    () =>
      deriveEffectiveComposerModelState({
        draft,
        selectedProvider: input.selectedProvider,
        threadModelSelection: input.threadModelSelection,
        projectModelSelection: input.projectModelSelection,
        customModelsByProvider: input.customModelsByProvider,
        ...(input.availableModelOptionsByProvider !== undefined
          ? { availableModelOptionsByProvider: input.availableModelOptionsByProvider }
          : {}),
      }),
    [
      input.availableModelOptionsByProvider,
      draft,
      input.customModelsByProvider,
      input.projectModelSelection,
      input.selectedProvider,
      input.threadModelSelection,
    ],
  );
}

// Mark drafts as promoted first; route/composer cleanup happens after the server thread starts.
export function markPromotedDraftThreads(serverThreadIds: ReadonlySet<ThreadId>): void {
  const store = useComposerDraftStore.getState();
  const draftThreadIds = Object.keys(store.draftThreadsByThreadId) as ThreadId[];
  for (const draftId of draftThreadIds) {
    if (serverThreadIds.has(draftId)) store.markDraftThreadPromoting(draftId);
  }
}

export function finalizePromotedDraftThreads(serverThreadIds: ReadonlySet<ThreadId>): void {
  const store = useComposerDraftStore.getState();
  for (const threadId of serverThreadIds) store.finalizePromotedDraftThread(threadId);
}
