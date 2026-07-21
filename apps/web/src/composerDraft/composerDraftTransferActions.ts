// FILE: composerDraftTransferActions.ts
// Purpose: Own draft transfer, restored-plan metadata, and composer content reset.
// Layer: Web composer action slice

import * as Equal from "effect/Equal";
import {
  buildTransferredComposerDraft,
  createEmptyThreadDraft,
  shouldRemoveDraft,
} from "./composerDraftContentState";
import { revokeDraftComposerImagePreviewUrls } from "./composerDraftImageLifecycle";
import type {
  ComposerDraftStoreGet,
  ComposerDraftStoreSet,
  ComposerDraftStoreState,
  ComposerThreadDraftState,
} from "./composerDraftState";

type DeleteDraftComposerImageBlobs = (draft: ComposerThreadDraftState | undefined) => void;

type ComposerDraftTransferActions = Pick<
  ComposerDraftStoreState,
  "copyTransferableComposerState" | "setRestoredSourceProposedPlan" | "clearComposerContent"
>;

export function createComposerDraftTransferActions(
  set: ComposerDraftStoreSet,
  get: ComposerDraftStoreGet,
  deleteDraftComposerImageBlobs: DeleteDraftComposerImageBlobs,
): ComposerDraftTransferActions {
  return {
    copyTransferableComposerState: (sourceThreadId, targetThreadId) => {
      if (sourceThreadId.length === 0 || targetThreadId.length === 0) return;
      set((state) => {
        const sourceDraft = state.draftsByThreadId[sourceThreadId];
        if (!sourceDraft) return state;
        const nextDraft = buildTransferredComposerDraft({
          sourceDraft,
          targetDraft: state.draftsByThreadId[targetThreadId],
          targetThreadId,
        });
        const currentTargetDraft = state.draftsByThreadId[targetThreadId];
        if (Equal.equals(currentTargetDraft, nextDraft)) return state;
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) delete nextDraftsByThreadId[targetThreadId];
        else nextDraftsByThreadId[targetThreadId] = nextDraft;
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    setRestoredSourceProposedPlan: (threadId, source) => {
      if (threadId.length === 0) return;
      set((state) => {
        const current = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          restoredSourceProposedPlan: source,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) delete nextDraftsByThreadId[threadId];
        else nextDraftsByThreadId[threadId] = nextDraft;
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    clearComposerContent: (threadId, options) => {
      if (threadId.length === 0) return;
      const clearedDraft = get().draftsByThreadId[threadId];
      deleteDraftComposerImageBlobs(clearedDraft);
      if (options?.preservePreviewUrls !== true) {
        revokeDraftComposerImagePreviewUrls(clearedDraft);
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) return state;
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          prompt: "",
          promptHistorySavedDraft: null,
          images: [],
          files: [],
          nonPersistedImageIds: [],
          persistedAttachments: [],
          assistantSelections: [],
          terminalContexts: [],
          fileComments: [],
          pastedTexts: [],
          skills: [],
          mentions: [],
          restoredSourceProposedPlan: null,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) delete nextDraftsByThreadId[threadId];
        else nextDraftsByThreadId[threadId] = nextDraft;
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
  };
}
