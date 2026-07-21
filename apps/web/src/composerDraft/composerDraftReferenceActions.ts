// FILE: composerDraftReferenceActions.ts
// Purpose: Own skills, mentions, files, selections, comments, and pasted-text actions.
// Layer: Web composer action slice

import * as Equal from "effect/Equal";
import type { ComposerFileAttachment } from "./composerDraftContracts";
import {
  assistantSelectionDedupKey,
  composerFileDedupKey,
  createEmptyThreadDraft,
  fileCommentDedupKey,
  normalizeAssistantSelection,
  normalizeFileComment,
  normalizePastedTexts,
  shouldRemoveDraft,
} from "./composerDraftContentState";
import type {
  ComposerDraftStoreSet,
  ComposerDraftStoreState,
  ComposerThreadDraftState,
} from "./composerDraftState";

type ComposerDraftReferenceActions = Pick<
  ComposerDraftStoreState,
  | "setSkills"
  | "setMentions"
  | "addFiles"
  | "removeFile"
  | "addAssistantSelection"
  | "removeAssistantSelection"
  | "clearAssistantSelections"
  | "addFileComment"
  | "removeFileComment"
  | "clearFileComments"
  | "addPastedTexts"
  | "removePastedText"
  | "clearPastedTexts"
>;

export function createComposerDraftReferenceActions(
  set: ComposerDraftStoreSet,
): ComposerDraftReferenceActions {
  return {
    setSkills: (threadId, skills) => {
      if (threadId.length === 0) {
        return;
      }
      const nextSkills = [...skills];
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        if (Equal.equals(existing.skills, nextSkills)) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...existing,
          skills: nextSkills,
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
    setMentions: (threadId, mentions) => {
      if (threadId.length === 0) {
        return;
      }
      const nextMentions = [...mentions];
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        if (Equal.equals(existing.mentions, nextMentions)) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...existing,
          mentions: nextMentions,
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
    addFiles: (threadId, files) => {
      if (threadId.length === 0 || files.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const existingIds = new Set(existing.files.map((file) => file.id));
        const existingDedupKeys = new Set(existing.files.map((file) => composerFileDedupKey(file)));
        const dedupedIncoming: ComposerFileAttachment[] = [];
        for (const file of files) {
          const dedupKey = composerFileDedupKey(file);
          if (existingIds.has(file.id) || existingDedupKeys.has(dedupKey)) {
            continue;
          }
          dedupedIncoming.push(file);
          existingIds.add(file.id);
          existingDedupKeys.add(dedupKey);
        }
        if (dedupedIncoming.length === 0) {
          return state;
        }
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              files: [...existing.files, ...dedupedIncoming],
            },
          },
        };
      });
    },
    removeFile: (threadId, fileId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          files: current.files.filter((file) => file.id !== fileId),
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
    addAssistantSelection: (threadId, selection) => {
      if (threadId.length === 0) {
        return false;
      }
      let inserted = false;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const normalizedSelection = normalizeAssistantSelection(selection);
        if (!normalizedSelection) {
          return state;
        }
        const dedupKey = assistantSelectionDedupKey(normalizedSelection);
        if (
          existing.assistantSelections.some((entry) => entry.id === normalizedSelection.id) ||
          existing.assistantSelections.some(
            (entry) => assistantSelectionDedupKey(entry) === dedupKey,
          )
        ) {
          return state;
        }
        inserted = true;
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              assistantSelections: [...existing.assistantSelections, normalizedSelection],
            },
          },
        };
      });
      return inserted;
    },
    removeAssistantSelection: (threadId, selectionId) => {
      if (threadId.length === 0 || selectionId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          assistantSelections: current.assistantSelections.filter(
            (selection) => selection.id !== selectionId,
          ),
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
    clearAssistantSelections: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.assistantSelections.length === 0) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          assistantSelections: [],
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
    addFileComment: (threadId, comment) => {
      if (threadId.length === 0) {
        return false;
      }
      let inserted = false;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const normalizedComment = normalizeFileComment(comment);
        if (!normalizedComment) {
          return state;
        }
        const dedupKey = fileCommentDedupKey(normalizedComment);
        if (
          existing.fileComments.some((entry) => entry.id === normalizedComment.id) ||
          existing.fileComments.some((entry) => fileCommentDedupKey(entry) === dedupKey)
        ) {
          return state;
        }
        inserted = true;
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              fileComments: [...existing.fileComments, normalizedComment],
            },
          },
        };
      });
      return inserted;
    },
    removeFileComment: (threadId, commentId) => {
      if (threadId.length === 0 || commentId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          fileComments: current.fileComments.filter((comment) => comment.id !== commentId),
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
    clearFileComments: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.fileComments.length === 0) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          fileComments: [],
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
    addPastedTexts: (threadId, pastedTexts) => {
      if (threadId.length === 0 || pastedTexts.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const acceptedPastedTexts = normalizePastedTexts([
          ...existing.pastedTexts,
          ...pastedTexts,
        ]).slice(existing.pastedTexts.length);
        if (acceptedPastedTexts.length === 0) {
          return state;
        }
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              pastedTexts: [...existing.pastedTexts, ...acceptedPastedTexts],
            },
          },
        };
      });
    },
    removePastedText: (threadId, pastedTextId) => {
      if (threadId.length === 0 || pastedTextId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          pastedTexts: current.pastedTexts.filter((pasted) => pasted.id !== pastedTextId),
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
    clearPastedTexts: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.pastedTexts.length === 0) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          pastedTexts: [],
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
  };
}
