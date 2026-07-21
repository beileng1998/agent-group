// FILE: composerDraftImageLifecycle.ts
// Purpose: Own composer preview URL lifetimes and blob-reference comparisons.
// Layer: Web composer image lifecycle

import type {
  ComposerImageAttachment,
  ComposerPromptHistorySavedDraft,
  PersistedComposerImageAttachment,
  QueuedComposerTurn,
} from "./composerDraftContracts";
import type { ComposerThreadDraftState } from "./composerDraftState";

export function cloneComposerImageAttachment(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function revokeObjectPreviewUrl(previewUrl: string): void {
  if (typeof URL === "undefined") {
    return;
  }
  if (!previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeQueuedTurnPreviewUrls(queuedTurn: QueuedComposerTurn): void {
  if (queuedTurn.kind !== "chat") {
    return;
  }
  for (const image of queuedTurn.images) {
    revokeObjectPreviewUrl(image.previewUrl);
  }
}

export function revokePromptHistorySavedDraftPreviewUrls(
  savedDraft: ComposerPromptHistorySavedDraft | null | undefined,
): void {
  if (!savedDraft) {
    return;
  }
  for (const image of savedDraft.images) {
    revokeObjectPreviewUrl(image.previewUrl);
  }
}

// Release any preview URLs still owned by this draft before we drop it from the store.
export function revokeDraftPreviewUrls(draft: ComposerThreadDraftState | undefined): void {
  if (!draft) {
    return;
  }
  for (const image of draft.images) {
    revokeObjectPreviewUrl(image.previewUrl);
  }
  for (const queuedTurn of draft.queuedTurns) {
    revokeQueuedTurnPreviewUrls(queuedTurn);
  }
  revokePromptHistorySavedDraftPreviewUrls(draft.promptHistorySavedDraft);
}

export function revokeDraftComposerImagePreviewUrls(
  draft: ComposerThreadDraftState | undefined,
): void {
  if (!draft) {
    return;
  }
  for (const image of draft.images) {
    revokeObjectPreviewUrl(image.previewUrl);
  }
  revokePromptHistorySavedDraftPreviewUrls(draft.promptHistorySavedDraft);
}

export function isComposerImageBlobReferenced(
  draftsByThreadId: Readonly<Record<string, ComposerThreadDraftState | undefined>>,
  blobKey: string,
): boolean {
  if (blobKey.length === 0) return false;
  for (const draft of Object.values(draftsByThreadId)) {
    if (!draft) continue;
    if (draft.persistedAttachments.some((attachment) => attachment.blobKey === blobKey)) {
      return true;
    }
    if (
      draft.promptHistorySavedDraft?.persistedAttachments.some(
        (attachment) => attachment.blobKey === blobKey,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function findSupersededComposerImageBlobAttachments(
  previousAttachments: ReadonlyArray<PersistedComposerImageAttachment>,
  nextAttachments: ReadonlyArray<PersistedComposerImageAttachment>,
): PersistedComposerImageAttachment[] {
  const nextBlobKeys = new Set(
    nextAttachments.flatMap((attachment) => (attachment.blobKey ? [attachment.blobKey] : [])),
  );
  return previousAttachments.filter((attachment) => {
    const blobKey = attachment.blobKey;
    return Boolean(blobKey && !nextBlobKeys.has(blobKey));
  });
}
