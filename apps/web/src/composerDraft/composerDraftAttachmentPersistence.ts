// FILE: composerDraftAttachmentPersistence.ts
// Purpose: Serialize, stage, flush, and verify persisted composer attachments.
// Layer: Web composer attachment persistence

import { ThreadId } from "@agent-group/contracts";
import * as Schema from "effect/Schema";
import { getLocalStorageItem } from "../hooks/useLocalStorage";
import { createDebouncedStorage, createMemoryStorage } from "../lib/storage";
import { shouldRemoveDraft } from "./composerDraftContentState";
import {
  PersistedComposerImageAttachment,
  type ComposerAttachmentPersistenceResult,
  type ComposerImageAttachment,
} from "./composerDraftContracts";
import { findSupersededComposerImageBlobAttachments } from "./composerDraftImageLifecycle";
import type { ComposerDraftStoreState, ComposerThreadDraftState } from "./composerDraftState";

type DeletePersistedComposerImageBlobs = (
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
) => void;

export const COMPOSER_DRAFT_STORAGE_KEY = "agent-group:composer-drafts:v1";
export const COMPOSER_DRAFT_STORAGE_VERSION = 5;
const COMPOSER_PERSIST_DEBOUNCE_MS = 300;

export const composerDebouncedStorage = createDebouncedStorage(
  typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
  COMPOSER_PERSIST_DEBOUNCE_MS,
);
const composerAttachmentPersistenceQueueByThreadId = new Map<string, Promise<void>>();

function enqueueComposerAttachmentPersistence<Result>(
  threadId: ThreadId,
  operation: () => Promise<Result> | Result,
): Promise<Result> {
  const previous = composerAttachmentPersistenceQueueByThreadId.get(threadId);
  let result: Promise<Result>;
  if (previous) {
    result = previous.then(operation, operation);
  } else {
    try {
      result = Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  }
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  composerAttachmentPersistenceQueueByThreadId.set(threadId, settled);
  void settled.then(() => {
    if (composerAttachmentPersistenceQueueByThreadId.get(threadId) === settled) {
      composerAttachmentPersistenceQueueByThreadId.delete(threadId);
    }
  });
  return result;
}

// Flush pending composer draft writes before page unload to prevent data loss.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    composerDebouncedStorage.flush();
  });
}

type PersistedAttachmentIdsRead =
  | { available: true; attachmentIds: string[] }
  | { available: false };

function asUnknownRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPersistedComposerDraftsRecord(): Record<string, unknown> | null {
  const persisted = asUnknownRecord(
    getLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY, Schema.Unknown),
  );
  if (!persisted || persisted.version !== COMPOSER_DRAFT_STORAGE_VERSION) return null;
  const state = asUnknownRecord(persisted.state);
  return state ? asUnknownRecord(state.draftsByThreadId) : null;
}

function decodePersistedAttachmentIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const attachmentIds: string[] = [];
  for (const candidate of value) {
    try {
      attachmentIds.push(Schema.decodeUnknownSync(PersistedComposerImageAttachment)(candidate).id);
    } catch {
      // Ignore unrelated malformed entries. The attempted attachment still has
      // to decode successfully and appear below before its native capture is acknowledged.
    }
  }
  return attachmentIds;
}

type ComposerDraftStoreSet = (
  partial:
    | ComposerDraftStoreState
    | Partial<ComposerDraftStoreState>
    | ((
        state: ComposerDraftStoreState,
      ) => ComposerDraftStoreState | Partial<ComposerDraftStoreState>),
  replace?: false,
) => void;

type ComposerDraftStoreGet = () => Pick<ComposerDraftStoreState, "draftsByThreadId">;

// The live draft and its prompt-history snapshot carry the same attachment
// bookkeeping fields; a slot abstracts which of the two a sync/verify targets.
interface ComposerAttachmentSlotView {
  readonly images: ComposerImageAttachment[];
  readonly nonPersistedImageIds: string[];
  readonly persistedAttachments: PersistedComposerImageAttachment[];
}

interface ComposerAttachmentSlot {
  readonly key: string;
  readonly read: (draft: ComposerThreadDraftState) => ComposerAttachmentSlotView | null;
  readonly write: (
    draft: ComposerThreadDraftState,
    updates: {
      persistedAttachments: PersistedComposerImageAttachment[];
      nonPersistedImageIds: string[];
    },
  ) => ComposerThreadDraftState;
  readonly readStoredAttachmentIds: (storedDraft: Record<string, unknown>) => string[] | null;
  readonly stageNonPersistedImageIds: (
    view: ComposerAttachmentSlotView,
    stagedAttachmentIds: ReadonlySet<string>,
  ) => string[];
}

export const DRAFT_ATTACHMENT_SLOT: ComposerAttachmentSlot = {
  key: "draft",
  read: (draft) => draft,
  write: (draft, updates) => ({ ...draft, ...updates }),
  readStoredAttachmentIds: (storedDraft) => decodePersistedAttachmentIds(storedDraft.attachments),
  stageNonPersistedImageIds: (view, stagedAttachmentIds) =>
    view.nonPersistedImageIds.filter((id) => !stagedAttachmentIds.has(id)),
};

export const PROMPT_HISTORY_ATTACHMENT_SLOT: ComposerAttachmentSlot = {
  key: "prompt-history",
  read: (draft) => draft.promptHistorySavedDraft,
  write: (draft, updates) =>
    draft.promptHistorySavedDraft
      ? { ...draft, promptHistorySavedDraft: { ...draft.promptHistorySavedDraft, ...updates } }
      : draft,
  readStoredAttachmentIds: (storedDraft) => {
    const savedDraft = asUnknownRecord(storedDraft.promptHistorySavedDraft);
    if (!savedDraft) return null;
    return decodePersistedAttachmentIds(savedDraft.attachments ?? []);
  },
  stageNonPersistedImageIds: (view, stagedAttachmentIds) =>
    view.images.map((image) => image.id).filter((id) => !stagedAttachmentIds.has(id)),
};

function readPersistedAttachmentIdsFromStorage(
  threadId: ThreadId,
  slot: ComposerAttachmentSlot,
): PersistedAttachmentIdsRead {
  if (threadId.length === 0) {
    return { available: false };
  }
  try {
    const draft = asUnknownRecord(readPersistedComposerDraftsRecord()?.[threadId]);
    if (!draft) return { available: false };
    const attachmentIds = slot.readStoredAttachmentIds(draft);
    if (!attachmentIds) return { available: false };
    return {
      available: true,
      attachmentIds,
    };
  } catch {
    return { available: false };
  }
}

function verifyPersistedAttachmentsForSlot(
  threadId: ThreadId,
  attachments: PersistedComposerImageAttachment[],
  get: ComposerDraftStoreGet,
  set: ComposerDraftStoreSet,
  slot: ComposerAttachmentSlot,
  applyStateUpdate: boolean,
  deleteBlobs: DeletePersistedComposerImageBlobs,
): ComposerAttachmentPersistenceResult {
  let persistedIdsRead: PersistedAttachmentIdsRead = { available: false };
  try {
    composerDebouncedStorage.flush();
    persistedIdsRead = readPersistedAttachmentIdsFromStorage(threadId, slot);
  } catch {
    persistedIdsRead = { available: false };
  }
  const persistedIdSet = new Set(persistedIdsRead.available ? persistedIdsRead.attachmentIds : []);
  let draftPresent = false;
  let verifiedAttachmentIds = new Set<string>();
  let retainedAttachmentIds = new Set<string>();
  const verifyDraft = (current: ComposerThreadDraftState): ComposerThreadDraftState | null => {
    const view = slot.read(current);
    if (!view) return null;
    draftPresent = true;
    const imageIdSet = new Set(view.images.map((image) => image.id));
    const retainedAttachments = attachments.filter((attachment) => imageIdSet.has(attachment.id));
    retainedAttachmentIds = new Set(retainedAttachments.map((attachment) => attachment.id));
    const persistedAttachments = persistedIdsRead.available
      ? retainedAttachments.filter((attachment) => persistedIdSet.has(attachment.id))
      : retainedAttachments;
    verifiedAttachmentIds = new Set(persistedAttachments.map((attachment) => attachment.id));
    const nonPersistedImageIds = persistedIdsRead.available
      ? view.images.map((image) => image.id).filter((imageId) => !persistedIdSet.has(imageId))
      : [...new Set([...view.nonPersistedImageIds, ...retainedAttachmentIds])];
    return slot.write(current, { persistedAttachments, nonPersistedImageIds });
  };
  if (applyStateUpdate) {
    set((state) => {
      const current = state.draftsByThreadId[threadId];
      const nextDraft = current ? verifyDraft(current) : null;
      if (!nextDraft) {
        return state;
      }
      const nextDraftsByThreadId = { ...state.draftsByThreadId };
      if (shouldRemoveDraft(nextDraft)) {
        delete nextDraftsByThreadId[threadId];
      } else {
        nextDraftsByThreadId[threadId] = nextDraft;
      }
      return { draftsByThreadId: nextDraftsByThreadId };
    });
  } else {
    // Superseded by a newer sync for this slot: report on this call's own
    // attachments without rolling back the newer staged draft state.
    const current = get().draftsByThreadId[threadId];
    if (current) verifyDraft(current);
  }
  const acceptedAttachmentIds = persistedIdsRead.available
    ? verifiedAttachmentIds
    : retainedAttachmentIds;
  const rejectedAttachments = attachments.filter(
    (attachment) => !acceptedAttachmentIds.has(attachment.id),
  );
  deleteBlobs(rejectedAttachments);
  if (!draftPresent || rejectedAttachments.length > 0) return "rejected";
  return persistedIdsRead.available ? "persisted" : "unverified";
}

const composerAttachmentSyncGenerationByKey = new Map<string, number>();

export function syncPersistedAttachmentsForSlot(
  threadId: ThreadId,
  attachments: PersistedComposerImageAttachment[],
  get: ComposerDraftStoreGet,
  set: ComposerDraftStoreSet,
  slot: ComposerAttachmentSlot,
  deleteBlobs: DeletePersistedComposerImageBlobs,
): Promise<ComposerAttachmentPersistenceResult> {
  if (threadId.length === 0) {
    return Promise.resolve("rejected");
  }
  const generationKey = `${slot.key}:${threadId}`;
  const generation = (composerAttachmentSyncGenerationByKey.get(generationKey) ?? 0) + 1;
  composerAttachmentSyncGenerationByKey.set(generationKey, generation);
  try {
    // Stage synchronously: a reload right after this call must already see the
    // attempted attachments in the persisted snapshot, even while an earlier
    // sync for this thread is still verifying.
    const currentDraft = get().draftsByThreadId[threadId];
    const previousAttachments = currentDraft
      ? (slot.read(currentDraft)?.persistedAttachments ?? [])
      : [];
    const supersededBlobAttachments = findSupersededComposerImageBlobAttachments(
      previousAttachments,
      attachments,
    );
    const attachmentIdSet = new Set(attachments.map((attachment) => attachment.id));
    set((state) => {
      const current = state.draftsByThreadId[threadId];
      const view = current ? slot.read(current) : null;
      if (!current || !view) {
        return state;
      }
      const nextDraft = slot.write(current, {
        persistedAttachments: attachments,
        nonPersistedImageIds: slot.stageNonPersistedImageIds(view, attachmentIdSet),
      });
      const nextDraftsByThreadId = { ...state.draftsByThreadId };
      if (shouldRemoveDraft(nextDraft)) {
        delete nextDraftsByThreadId[threadId];
      } else {
        nextDraftsByThreadId[threadId] = nextDraft;
      }
      return { draftsByThreadId: nextDraftsByThreadId };
    });
    deleteBlobs(supersededBlobAttachments);
  } catch (error) {
    return Promise.reject(error);
  }
  // Verification stays serialized per thread (across both slots) so overlapping
  // verifications cannot roll back each other's committed state.
  return enqueueComposerAttachmentPersistence(threadId, () =>
    verifyPersistedAttachmentsForSlot(
      threadId,
      attachments,
      get,
      set,
      slot,
      composerAttachmentSyncGenerationByKey.get(generationKey) === generation,
      deleteBlobs,
    ),
  );
}
