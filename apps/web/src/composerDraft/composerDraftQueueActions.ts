// FILE: composerDraftQueueActions.ts
// Purpose: Own queued composer turn insertion, ordering, and cleanup.
// Layer: Web composer action slice

import { createEmptyThreadDraft, shouldRemoveDraft } from "./composerDraftContentState";
import { revokeQueuedTurnPreviewUrls } from "./composerDraftImageLifecycle";
import type {
  ComposerDraftStoreGet,
  ComposerDraftStoreSet,
  ComposerDraftStoreState,
  ComposerThreadDraftState,
} from "./composerDraftState";

type ComposerDraftQueueActions = Pick<
  ComposerDraftStoreState,
  "enqueueQueuedTurn" | "insertQueuedTurn" | "removeQueuedTurn"
>;

export function createComposerDraftQueueActions(
  set: ComposerDraftStoreSet,
  get: ComposerDraftStoreGet,
): ComposerDraftQueueActions {
  return {
    enqueueQueuedTurn: (threadId, queuedTurn) => {
      if (threadId.length === 0) return;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              queuedTurns: [...existing.queuedTurns, queuedTurn],
            },
          },
        };
      });
    },
    insertQueuedTurn: (threadId, queuedTurn, index) => {
      if (threadId.length === 0) return;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const boundedIndex = Math.max(0, Math.min(existing.queuedTurns.length, index));
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              queuedTurns: [
                ...existing.queuedTurns.slice(0, boundedIndex),
                queuedTurn,
                ...existing.queuedTurns.slice(boundedIndex),
              ],
            },
          },
        };
      });
    },
    removeQueuedTurn: (threadId, queuedTurnId) => {
      if (threadId.length === 0 || queuedTurnId.length === 0) return;
      const removedQueuedTurn = get().draftsByThreadId[threadId]?.queuedTurns.find(
        (entry) => entry.id === queuedTurnId,
      );
      if (removedQueuedTurn) revokeQueuedTurnPreviewUrls(removedQueuedTurn);
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.queuedTurns.every((entry) => entry.id !== queuedTurnId)) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          queuedTurns: current.queuedTurns.filter((entry) => entry.id !== queuedTurnId),
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) delete nextDraftsByThreadId[threadId];
        else nextDraftsByThreadId[threadId] = nextDraft;
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
  };
}
