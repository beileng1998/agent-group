// FILE: composerDraftStoreRoot.ts
// Purpose: Compose the single persisted composer store from domain action slices.
// Layer: Web composer store root

import type { ThreadId } from "@agent-group/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { deleteComposerImageBlob } from "../lib/composerImageBlobStore";
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  COMPOSER_DRAFT_STORAGE_VERSION,
  composerDebouncedStorage,
} from "./composerDraftAttachmentPersistence";
import { createComposerDraftImageActions } from "./composerDraftImageActions";
import { isComposerImageBlobReferenced } from "./composerDraftImageLifecycle";
import { createComposerDraftModelActions } from "./composerDraftModelActions";
import { createComposerDraftPromptActions } from "./composerDraftPromptActions";
import { createComposerDraftQueueActions } from "./composerDraftQueueActions";
import { createComposerDraftReferenceActions } from "./composerDraftReferenceActions";
import type { PersistedComposerImageAttachment } from "./composerDraftContracts";
import {
  migratePersistedComposerDraftStoreState,
  normalizeCurrentPersistedComposerDraftStoreState,
} from "./composerDraftPersistenceStateCodec";
import { partializeComposerDraftStoreState } from "./composerDraftPersistenceProjection";
import type { ComposerDraftStoreState, ComposerThreadDraftState } from "./composerDraftState";
import { createComposerDraftThreadActions } from "./composerDraftThreadActions";
import { createComposerDraftTransferActions } from "./composerDraftTransferActions";
import { toHydratedThreadDraft } from "./composerDraftHydration";

function deletePersistedComposerImageBlobs(
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
): void {
  const candidateBlobKeys = new Set(
    attachments.flatMap((attachment) => (attachment.blobKey ? [attachment.blobKey] : [])),
  );
  if (candidateBlobKeys.size === 0) return;

  // Copied drafts can temporarily share a source blob before the destination mounts.
  Promise.resolve().then(() => {
    const draftsByThreadId = useComposerDraftStore.getState().draftsByThreadId;
    for (const blobKey of candidateBlobKeys) {
      if (isComposerImageBlobReferenced(draftsByThreadId, blobKey)) continue;
      void deleteComposerImageBlob(blobKey).catch((error) => {
        console.warn("[composer-images] Could not delete persisted image blob", error);
      });
    }
  });
}

function deleteDraftComposerImageBlobs(draft: ComposerThreadDraftState | undefined): void {
  if (!draft) return;
  deletePersistedComposerImageBlobs(draft.persistedAttachments);
  if (draft.promptHistorySavedDraft) {
    deletePersistedComposerImageBlobs(draft.promptHistorySavedDraft.persistedAttachments);
  }
}

export const useComposerDraftStore = create<ComposerDraftStoreState>()(
  persist(
    (set, get) => ({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
      ...createComposerDraftThreadActions(set, get, deleteDraftComposerImageBlobs),
      ...createComposerDraftModelActions(set, get),
      ...createComposerDraftPromptActions(set, get, deletePersistedComposerImageBlobs),
      ...createComposerDraftReferenceActions(set),
      ...createComposerDraftQueueActions(set, get),
      ...createComposerDraftImageActions(set, get, deletePersistedComposerImageBlobs),
      ...createComposerDraftTransferActions(set, get, deleteDraftComposerImageBlobs),
    }),
    {
      name: COMPOSER_DRAFT_STORAGE_KEY,
      version: COMPOSER_DRAFT_STORAGE_VERSION,
      storage: createJSONStorage(() => composerDebouncedStorage),
      migrate: migratePersistedComposerDraftStoreState,
      partialize: partializeComposerDraftStoreState,
      merge: (persistedState, currentState) => {
        const normalizedPersisted =
          normalizeCurrentPersistedComposerDraftStoreState(persistedState);
        const draftsByThreadId = Object.fromEntries(
          Object.entries(normalizedPersisted.draftsByThreadId).map(([threadId, draft]) => [
            threadId,
            toHydratedThreadDraft(threadId as ThreadId, draft),
          ]),
        );
        return {
          ...currentState,
          draftsByThreadId,
          draftThreadsByThreadId: normalizedPersisted.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: normalizedPersisted.projectDraftThreadIdByProjectId,
          stickyModelSelectionByProvider: normalizedPersisted.stickyModelSelectionByProvider ?? {},
          stickyActiveProvider: normalizedPersisted.stickyActiveProvider ?? null,
        };
      },
    },
  ),
);
