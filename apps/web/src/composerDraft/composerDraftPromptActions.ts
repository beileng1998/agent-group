// FILE: composerDraftPromptActions.ts
// Purpose: Own prompt-history and terminal-context composer actions.
// Layer: Web composer action slice

import { ensureInlineTerminalContextPlaceholders } from "../lib/terminalContext";
import {
  createEmptyThreadDraft,
  mergeComposerImages,
  normalizeAssistantSelections,
  normalizeFileComments,
  normalizePastedTexts,
  normalizeTerminalContextForThread,
  normalizeTerminalContextsForThread,
  shouldRemoveDraft,
  terminalContextDedupKey,
} from "./composerDraftContentState";
import {
  PROMPT_HISTORY_ATTACHMENT_SLOT,
  syncPersistedAttachmentsForSlot,
} from "./composerDraftAttachmentPersistence";
import {
  revokeObjectPreviewUrl,
  revokePromptHistorySavedDraftPreviewUrls,
} from "./composerDraftImageLifecycle";
import type { PersistedComposerImageAttachment } from "./composerDraftContracts";
import type {
  ComposerDraftStoreGet,
  ComposerDraftStoreSet,
  ComposerDraftStoreState,
  ComposerThreadDraftState,
} from "./composerDraftState";

type DeletePersistedComposerImageBlobs = (
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
) => void;
type ComposerDraftPromptActions = Pick<
  ComposerDraftStoreState,
  | "setPrompt"
  | "setPromptHistorySavedDraft"
  | "restorePromptHistorySavedDraft"
  | "addPromptHistorySavedDraftImage"
  | "syncPromptHistorySavedDraftPersistedAttachments"
  | "setTerminalContexts"
  | "insertTerminalContext"
  | "addTerminalContext"
  | "addTerminalContexts"
  | "removeTerminalContext"
  | "clearTerminalContexts"
>;

export function createComposerDraftPromptActions(
  set: ComposerDraftStoreSet,
  get: ComposerDraftStoreGet,
  deletePersistedComposerImageBlobs: DeletePersistedComposerImageBlobs,
): ComposerDraftPromptActions {
  return {
    setPrompt: (threadId, prompt) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const nextDraft: ComposerThreadDraftState = {
          ...existing,
          prompt,
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
    setPromptHistorySavedDraft: (threadId, savedDraft) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        if ((existing?.promptHistorySavedDraft ?? null) === savedDraft) {
          return state;
        }
        if (existing?.promptHistorySavedDraft) {
          revokePromptHistorySavedDraftPreviewUrls(existing?.promptHistorySavedDraft);
          if (savedDraft === null) {
            deletePersistedComposerImageBlobs(
              existing.promptHistorySavedDraft.persistedAttachments,
            );
          }
        }
        const nextDraft: ComposerThreadDraftState = {
          ...(existing ?? createEmptyThreadDraft()),
          promptHistorySavedDraft: savedDraft,
          ...(savedDraft !== null
            ? {
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
              }
            : {}),
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
    restorePromptHistorySavedDraft: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        const savedDraft = current?.promptHistorySavedDraft ?? null;
        if (!current || !savedDraft) {
          return state;
        }
        const restoredImageIds = new Set(savedDraft.images.map((image) => image.id));
        for (const image of current.images) {
          if (!restoredImageIds.has(image.id)) {
            revokeObjectPreviewUrl(image.previewUrl);
          }
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          prompt: savedDraft.prompt,
          promptHistorySavedDraft: null,
          images: savedDraft.images,
          files: [...savedDraft.files],
          nonPersistedImageIds: [...savedDraft.nonPersistedImageIds],
          persistedAttachments: [...savedDraft.persistedAttachments],
          assistantSelections: normalizeAssistantSelections(savedDraft.assistantSelections),
          terminalContexts: normalizeTerminalContextsForThread(
            threadId,
            savedDraft.terminalContexts,
          ),
          fileComments: normalizeFileComments(savedDraft.fileComments),
          pastedTexts: normalizePastedTexts(savedDraft.pastedTexts),
          skills: [...savedDraft.skills],
          mentions: [...savedDraft.mentions],
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
    addPromptHistorySavedDraftImage: (threadId, image) => {
      if (threadId.length === 0) return;
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        const savedDraft = current?.promptHistorySavedDraft ?? null;
        if (!current || !savedDraft) {
          revokeObjectPreviewUrl(image.previewUrl);
          return state;
        }
        const images = mergeComposerImages(savedDraft.images, [image]);
        if (!images) return state;
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...current,
              promptHistorySavedDraft: {
                ...savedDraft,
                images,
              },
            },
          },
        };
      });
    },
    syncPromptHistorySavedDraftPersistedAttachments: (threadId, attachments) =>
      syncPersistedAttachmentsForSlot(
        threadId,
        attachments,
        get,
        set,
        PROMPT_HISTORY_ATTACHMENT_SLOT,
        deletePersistedComposerImageBlobs,
      ),
    setTerminalContexts: (threadId, contexts) => {
      if (threadId.length === 0) {
        return;
      }
      const normalizedContexts = normalizeTerminalContextsForThread(threadId, contexts);
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const nextDraft: ComposerThreadDraftState = {
          ...existing,
          prompt: ensureInlineTerminalContextPlaceholders(
            existing.prompt,
            normalizedContexts.length,
          ),
          terminalContexts: normalizedContexts,
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
    insertTerminalContext: (threadId, prompt, context, index) => {
      if (threadId.length === 0) {
        return false;
      }
      let inserted = false;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const normalizedContext = normalizeTerminalContextForThread(threadId, context);
        if (!normalizedContext) {
          return state;
        }
        const dedupKey = terminalContextDedupKey(normalizedContext);
        if (
          existing.terminalContexts.some((entry) => entry.id === normalizedContext.id) ||
          existing.terminalContexts.some((entry) => terminalContextDedupKey(entry) === dedupKey)
        ) {
          return state;
        }
        inserted = true;
        const boundedIndex = Math.max(0, Math.min(existing.terminalContexts.length, index));
        const nextDraft: ComposerThreadDraftState = {
          ...existing,
          prompt,
          terminalContexts: [
            ...existing.terminalContexts.slice(0, boundedIndex),
            normalizedContext,
            ...existing.terminalContexts.slice(boundedIndex),
          ],
        };
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: nextDraft,
          },
        };
      });
      return inserted;
    },
    addTerminalContext: (threadId, context) => {
      if (threadId.length === 0) {
        return;
      }
      get().addTerminalContexts(threadId, [context]);
    },
    addTerminalContexts: (threadId, contexts) => {
      if (threadId.length === 0 || contexts.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const acceptedContexts = normalizeTerminalContextsForThread(threadId, [
          ...existing.terminalContexts,
          ...contexts,
        ]).slice(existing.terminalContexts.length);
        if (acceptedContexts.length === 0) {
          return state;
        }
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              prompt: ensureInlineTerminalContextPlaceholders(
                existing.prompt,
                existing.terminalContexts.length + acceptedContexts.length,
              ),
              terminalContexts: [...existing.terminalContexts, ...acceptedContexts],
            },
          },
        };
      });
    },
    removeTerminalContext: (threadId, contextId) => {
      if (threadId.length === 0 || contextId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          terminalContexts: current.terminalContexts.filter((context) => context.id !== contextId),
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
    clearTerminalContexts: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.terminalContexts.length === 0) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          terminalContexts: [],
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
