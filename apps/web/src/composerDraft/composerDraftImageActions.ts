// FILE: composerDraftImageActions.ts
// Purpose: Own live composer images and their persisted attachment state.
// Layer: Web composer action slice

import type { ThreadId } from "@agent-group/contracts";
import { isComposerAppSnapCaptureSource } from "../lib/composerImageSource";
import {
  DRAFT_ATTACHMENT_SLOT,
  syncPersistedAttachmentsForSlot,
} from "./composerDraftAttachmentPersistence";
import {
  createEmptyThreadDraft,
  mergeComposerImages,
  shouldRemoveDraft,
} from "./composerDraftContentState";
import { revokeObjectPreviewUrl } from "./composerDraftImageLifecycle";
import type {
  ComposerImageAttachment,
  PersistedComposerImageAttachment,
} from "./composerDraftContracts";
import type {
  ComposerDraftStoreGet,
  ComposerDraftStoreSet,
  ComposerDraftStoreState,
  ComposerThreadDraftState,
} from "./composerDraftState";

type DeletePersistedComposerImageBlobs = (
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
) => void;

type ComposerDraftImageActions = Pick<
  ComposerDraftStoreState,
  | "addImage"
  | "addImages"
  | "removeImage"
  | "removeAppSnapCapture"
  | "clearPersistedAttachments"
  | "syncPersistedAttachments"
>;

export function createComposerDraftImageActions(
  set: ComposerDraftStoreSet,
  get: ComposerDraftStoreGet,
  deletePersistedComposerImageBlobs: DeletePersistedComposerImageBlobs,
): ComposerDraftImageActions {
  return {
    addImage: (threadId, image) => {
      if (threadId.length === 0) return;
      get().addImages(threadId, [image]);
    },
    addImages: (threadId, images) => {
      if (threadId.length === 0 || images.length === 0) return;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const mergedImages = mergeComposerImages(existing.images, images);
        if (!mergedImages) return state;
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: { ...existing, images: mergedImages },
          },
        };
      });
    },
    removeImage: (threadId, imageId) => {
      if (threadId.length === 0) return;
      const existing = get().draftsByThreadId[threadId];
      if (!existing) return;
      const removedImage = existing.images.find((image) => image.id === imageId);
      const removedPersistedAttachment = existing.persistedAttachments.find(
        (attachment) => attachment.id === imageId,
      );
      if (removedImage) revokeObjectPreviewUrl(removedImage.previewUrl);
      if (removedPersistedAttachment) {
        deletePersistedComposerImageBlobs([removedPersistedAttachment]);
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) return state;
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          images: current.images.filter((image) => image.id !== imageId),
          nonPersistedImageIds: current.nonPersistedImageIds.filter((id) => id !== imageId),
          persistedAttachments: current.persistedAttachments.filter(
            (attachment) => attachment.id !== imageId,
          ),
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) delete nextDraftsByThreadId[threadId];
        else nextDraftsByThreadId[threadId] = nextDraft;
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    removeAppSnapCapture: (captureId) => {
      if (captureId.length === 0) return;

      const removedImages: ComposerImageAttachment[] = [];
      const removedAttachments: PersistedComposerImageAttachment[] = [];
      for (const draft of Object.values(get().draftsByThreadId)) {
        removedImages.push(
          ...draft.images.filter((image) =>
            isComposerAppSnapCaptureSource(image.source, captureId),
          ),
          ...(draft.promptHistorySavedDraft?.images.filter((image) =>
            isComposerAppSnapCaptureSource(image.source, captureId),
          ) ?? []),
        );
        removedAttachments.push(
          ...draft.persistedAttachments.filter((attachment) =>
            isComposerAppSnapCaptureSource(attachment.source, captureId),
          ),
          ...(draft.promptHistorySavedDraft?.persistedAttachments.filter((attachment) =>
            isComposerAppSnapCaptureSource(attachment.source, captureId),
          ) ?? []),
        );
      }
      for (const image of removedImages) revokeObjectPreviewUrl(image.previewUrl);
      deletePersistedComposerImageBlobs(removedAttachments);

      set((state) => {
        let changed = false;
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        for (const [rawThreadId, current] of Object.entries(state.draftsByThreadId)) {
          const removedCurrentIds = new Set([
            ...current.images
              .filter((image) => isComposerAppSnapCaptureSource(image.source, captureId))
              .map((image) => image.id),
            ...current.persistedAttachments
              .filter((attachment) => isComposerAppSnapCaptureSource(attachment.source, captureId))
              .map((attachment) => attachment.id),
          ]);
          const savedDraft = current.promptHistorySavedDraft;
          const removedSavedIds = new Set([
            ...(savedDraft?.images
              .filter((image) => isComposerAppSnapCaptureSource(image.source, captureId))
              .map((image) => image.id) ?? []),
            ...(savedDraft?.persistedAttachments
              .filter((attachment) => isComposerAppSnapCaptureSource(attachment.source, captureId))
              .map((attachment) => attachment.id) ?? []),
          ]);
          if (removedCurrentIds.size === 0 && removedSavedIds.size === 0) continue;

          changed = true;
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            images: current.images.filter((image) => !removedCurrentIds.has(image.id)),
            persistedAttachments: current.persistedAttachments.filter(
              (attachment) => !removedCurrentIds.has(attachment.id),
            ),
            nonPersistedImageIds: current.nonPersistedImageIds.filter(
              (imageId) => !removedCurrentIds.has(imageId),
            ),
            ...(savedDraft
              ? {
                  promptHistorySavedDraft: {
                    ...savedDraft,
                    images: savedDraft.images.filter((image) => !removedSavedIds.has(image.id)),
                    persistedAttachments: savedDraft.persistedAttachments.filter(
                      (attachment) => !removedSavedIds.has(attachment.id),
                    ),
                    nonPersistedImageIds: savedDraft.nonPersistedImageIds.filter(
                      (imageId) => !removedSavedIds.has(imageId),
                    ),
                  },
                }
              : {}),
          };
          const threadId = rawThreadId as ThreadId;
          if (shouldRemoveDraft(nextDraft)) delete nextDraftsByThreadId[threadId];
          else nextDraftsByThreadId[threadId] = nextDraft;
        }
        return changed ? { draftsByThreadId: nextDraftsByThreadId } : state;
      });
    },
    clearPersistedAttachments: (threadId) => {
      if (threadId.length === 0) return;
      const existing = get().draftsByThreadId[threadId];
      if (existing) deletePersistedComposerImageBlobs(existing.persistedAttachments);
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) return state;
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          persistedAttachments: [],
          nonPersistedImageIds: [],
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) delete nextDraftsByThreadId[threadId];
        else nextDraftsByThreadId[threadId] = nextDraft;
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    syncPersistedAttachments: (threadId, attachments) =>
      syncPersistedAttachmentsForSlot(
        threadId,
        attachments,
        get,
        set,
        DRAFT_ATTACHMENT_SLOT,
        deletePersistedComposerImageBlobs,
      ),
  };
}
