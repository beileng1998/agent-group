// FILE: composerDraftThreadActions.ts
// Purpose: Own draft-thread registration, project slots, promotion, and cleanup actions.
// Layer: Web composer action slice

import type { ThreadId } from "@agent-group/contracts";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { revokeDraftPreviewUrls } from "./composerDraftImageLifecycle";
import type {
  ComposerThreadDraftState,
  DraftThreadState,
  ComposerDraftStoreGet,
  ComposerDraftStoreSet,
} from "./composerDraftState";
import {
  buildDraftThreadState,
  draftThreadStatesEqual,
  normalizeDraftThreadEntryPoint,
  projectDraftThreadMappingKey,
  projectIdFromDraftThreadMappingKey,
  removeProjectDraftMappingsForThread,
} from "./composerDraftThreadState";

type DeleteDraftComposerImageBlobs = (draft: ComposerThreadDraftState | undefined) => void;
type ComposerDraftThreadActions = Pick<
  import("./composerDraftState").ComposerDraftStoreState,
  | "getDraftThreadByProjectId"
  | "getDraftThread"
  | "setProjectDraftThreadId"
  | "registerDraftThread"
  | "setDraftThreadContext"
  | "moveDraftThreadToProject"
  | "clearProjectDraftThreadId"
  | "clearProjectDraftThreads"
  | "clearProjectDraftThreadById"
  | "markDraftThreadPromoting"
  | "finalizePromotedDraftThread"
  | "clearDraftThread"
>;

// Deletes a displaced draft only when no remaining project slot points at it.
function removeDraftThreadIfUnmappedWithCleanup(input: {
  threadId: ThreadId | undefined;
  projectDraftThreadIdByProjectId: Record<string, ThreadId>;
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>;
  deleteDraftComposerImageBlobs: DeleteDraftComposerImageBlobs;
}): {
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>;
} {
  if (
    !input.threadId ||
    Object.values(input.projectDraftThreadIdByProjectId).includes(input.threadId)
  ) {
    return {
      draftThreadsByThreadId: input.draftThreadsByThreadId,
      draftsByThreadId: input.draftsByThreadId,
    };
  }

  const nextDraftThreadsByThreadId = { ...input.draftThreadsByThreadId };
  delete nextDraftThreadsByThreadId[input.threadId];
  if (input.draftsByThreadId[input.threadId] === undefined) {
    return {
      draftThreadsByThreadId: nextDraftThreadsByThreadId,
      draftsByThreadId: input.draftsByThreadId,
    };
  }

  const removedDraft = input.draftsByThreadId[input.threadId];
  revokeDraftPreviewUrls(removedDraft);
  input.deleteDraftComposerImageBlobs(removedDraft);
  const nextDraftsByThreadId = { ...input.draftsByThreadId };
  delete nextDraftsByThreadId[input.threadId];
  return {
    draftThreadsByThreadId: nextDraftThreadsByThreadId,
    draftsByThreadId: nextDraftsByThreadId,
  };
}

export function createComposerDraftThreadActions(
  set: ComposerDraftStoreSet,
  get: ComposerDraftStoreGet,
  deleteDraftComposerImageBlobs: DeleteDraftComposerImageBlobs,
): ComposerDraftThreadActions {
  const removeDraftThreadIfUnmapped = (
    input: Omit<
      Parameters<typeof removeDraftThreadIfUnmappedWithCleanup>[0],
      "deleteDraftComposerImageBlobs"
    >,
  ) => removeDraftThreadIfUnmappedWithCleanup({ ...input, deleteDraftComposerImageBlobs });
  return {
    getDraftThreadByProjectId: (projectId, entryPoint = "chat") => {
      if (projectId.length === 0) {
        return null;
      }
      const threadId =
        get().projectDraftThreadIdByProjectId[projectDraftThreadMappingKey(projectId, entryPoint)];
      if (!threadId) {
        return null;
      }
      const draftThread = get().draftThreadsByThreadId[threadId];
      if (
        !draftThread ||
        draftThread.projectId !== projectId ||
        normalizeDraftThreadEntryPoint(draftThread.entryPoint) !== entryPoint ||
        draftThread.promotedTo !== undefined
      ) {
        return null;
      }
      return {
        threadId,
        ...draftThread,
      };
    },
    getDraftThread: (threadId) => {
      if (threadId.length === 0) {
        return null;
      }
      return get().draftThreadsByThreadId[threadId] ?? null;
    },
    setProjectDraftThreadId: (projectId, threadId, options) => {
      if (projectId.length === 0 || threadId.length === 0) {
        return;
      }
      set((state) => {
        const existingThread = state.draftThreadsByThreadId[threadId];
        const nextDraftThread = buildDraftThreadState({
          projectId,
          existingThread,
          options,
          createdAtMode: "accept-empty",
        });
        const mappingKey = projectDraftThreadMappingKey(projectId, nextDraftThread.entryPoint);
        const previousThreadIdForProject = state.projectDraftThreadIdByProjectId[mappingKey];
        const hasSameProjectMapping = previousThreadIdForProject === threadId;
        if (hasSameProjectMapping && draftThreadStatesEqual(existingThread, nextDraftThread)) {
          return state;
        }
        const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {
          ...state.projectDraftThreadIdByProjectId,
          [mappingKey]: threadId,
        };
        const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
          ...state.draftThreadsByThreadId,
          [threadId]: nextDraftThread,
        };
        const cleanedDrafts =
          previousThreadIdForProject === threadId
            ? {
                draftThreadsByThreadId: nextDraftThreadsByThreadId,
                draftsByThreadId: state.draftsByThreadId,
              }
            : removeDraftThreadIfUnmapped({
                threadId: previousThreadIdForProject,
                projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
                draftThreadsByThreadId: nextDraftThreadsByThreadId,
                draftsByThreadId: state.draftsByThreadId,
              });
        return {
          draftsByThreadId: cleanedDrafts.draftsByThreadId,
          draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
        };
      });
    },
    registerDraftThread: (threadId, options) => {
      if (threadId.length === 0 || options.projectId.length === 0) {
        return;
      }
      set((state) => {
        if (state.draftThreadsByThreadId[threadId]) {
          return state;
        }
        const worktreePath = options.worktreePath ?? null;
        const nextDraftThread: DraftThreadState = {
          projectId: options.projectId,
          createdAt: options.createdAt ?? new Date().toISOString(),
          runtimeMode: options.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          interactionMode: options.interactionMode ?? DEFAULT_INTERACTION_MODE,
          entryPoint: options.entryPoint ?? "chat",
          branch: options.branch ?? null,
          worktreePath,
          lastKnownPr: null,
          envMode: options.envMode ?? (worktreePath ? "worktree" : "local"),
          ...(options.isTemporary ? { isTemporary: true } : {}),
        };
        return {
          draftThreadsByThreadId: {
            ...state.draftThreadsByThreadId,
            [threadId]: nextDraftThread,
          },
        };
      });
    },
    setDraftThreadContext: (threadId, options) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftThreadsByThreadId[threadId];
        if (!existing) {
          return state;
        }
        const nextProjectId = options.projectId ?? existing.projectId;
        if (nextProjectId.length === 0) {
          return state;
        }
        const nextDraftThread = buildDraftThreadState({
          projectId: nextProjectId,
          existingThread: existing,
          options,
          createdAtMode: "preserve-existing-on-empty",
        });
        if (draftThreadStatesEqual(existing, nextDraftThread)) {
          return state;
        }
        const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {
          ...removeProjectDraftMappingsForThread(state.projectDraftThreadIdByProjectId, threadId),
          [projectDraftThreadMappingKey(nextProjectId, nextDraftThread.entryPoint)]: threadId,
        };
        return {
          draftThreadsByThreadId: {
            ...state.draftThreadsByThreadId,
            [threadId]: nextDraftThread,
          },
          projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
        };
      });
    },
    moveDraftThreadToProject: (threadId, projectId, options) => {
      if (threadId.length === 0 || projectId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftThreadsByThreadId[threadId];
        if (!existing) {
          return state;
        }
        const nextDraftThread = buildDraftThreadState({
          projectId,
          existingThread: existing,
          options,
          createdAtMode: "preserve-existing-on-empty",
        });
        const targetMappingKey = projectDraftThreadMappingKey(
          projectId,
          nextDraftThread.entryPoint,
        );
        const previousThreadIdForProject = state.projectDraftThreadIdByProjectId[targetMappingKey];
        const hasOnlyTargetMapping = Object.entries(state.projectDraftThreadIdByProjectId).every(
          ([mappingKey, mappedThreadId]) =>
            mappedThreadId !== threadId || mappingKey === targetMappingKey,
        );
        if (
          previousThreadIdForProject === threadId &&
          hasOnlyTargetMapping &&
          draftThreadStatesEqual(existing, nextDraftThread)
        ) {
          return state;
        }

        const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {
          ...removeProjectDraftMappingsForThread(state.projectDraftThreadIdByProjectId, threadId),
          [targetMappingKey]: threadId,
        };

        const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
          ...state.draftThreadsByThreadId,
          [threadId]: nextDraftThread,
        };
        const cleanedDrafts =
          previousThreadIdForProject === threadId
            ? {
                draftThreadsByThreadId: nextDraftThreadsByThreadId,
                draftsByThreadId: state.draftsByThreadId,
              }
            : removeDraftThreadIfUnmapped({
                threadId: previousThreadIdForProject,
                projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
                draftThreadsByThreadId: nextDraftThreadsByThreadId,
                draftsByThreadId: state.draftsByThreadId,
              });

        return {
          draftsByThreadId: cleanedDrafts.draftsByThreadId,
          draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
        };
      });
    },
    clearProjectDraftThreadId: (projectId, entryPoint = "chat") => {
      if (projectId.length === 0) {
        return;
      }
      set((state) => {
        const mappingKey = projectDraftThreadMappingKey(projectId, entryPoint);
        const threadId = state.projectDraftThreadIdByProjectId[mappingKey];
        if (threadId === undefined) {
          return state;
        }
        const { [mappingKey]: _removed, ...restProjectMappingsRaw } =
          state.projectDraftThreadIdByProjectId;
        const restProjectMappings = restProjectMappingsRaw as Record<string, ThreadId>;
        const cleanedDrafts = removeDraftThreadIfUnmapped({
          threadId,
          projectDraftThreadIdByProjectId: restProjectMappings,
          draftThreadsByThreadId: state.draftThreadsByThreadId,
          draftsByThreadId: state.draftsByThreadId,
        });
        return {
          draftsByThreadId: cleanedDrafts.draftsByThreadId,
          draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: restProjectMappings,
        };
      });
    },
    clearProjectDraftThreads: (projectId) => {
      if (projectId.length === 0) {
        return;
      }
      set((state) => {
        const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {};
        const removedThreadIds = new Set<ThreadId>();
        for (const [mappingKey, threadId] of Object.entries(
          state.projectDraftThreadIdByProjectId,
        )) {
          if (projectIdFromDraftThreadMappingKey(mappingKey) === projectId) {
            removedThreadIds.add(threadId);
            continue;
          }
          nextProjectDraftThreadIdByProjectId[mappingKey] = threadId;
        }
        if (removedThreadIds.size === 0) {
          return state;
        }
        let cleanedDrafts = {
          draftThreadsByThreadId: state.draftThreadsByThreadId,
          draftsByThreadId: state.draftsByThreadId,
        };
        for (const threadId of removedThreadIds) {
          cleanedDrafts = removeDraftThreadIfUnmapped({
            threadId,
            projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
            draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
            draftsByThreadId: cleanedDrafts.draftsByThreadId,
          });
        }
        return {
          draftsByThreadId: cleanedDrafts.draftsByThreadId,
          draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
        };
      });
    },
    clearProjectDraftThreadById: (projectId, threadId) => {
      if (projectId.length === 0 || threadId.length === 0) {
        return;
      }
      set((state) => {
        const matchingMappingKey = Object.entries(state.projectDraftThreadIdByProjectId).find(
          ([mappingKey, mappedThreadId]) =>
            projectIdFromDraftThreadMappingKey(mappingKey) === projectId &&
            mappedThreadId === threadId,
        )?.[0];
        if (!matchingMappingKey) {
          return state;
        }
        const { [matchingMappingKey]: _removed, ...restProjectMappingsRaw } =
          state.projectDraftThreadIdByProjectId;
        const restProjectMappings = restProjectMappingsRaw as Record<string, ThreadId>;
        const cleanedDrafts = removeDraftThreadIfUnmapped({
          threadId,
          projectDraftThreadIdByProjectId: restProjectMappings,
          draftThreadsByThreadId: state.draftThreadsByThreadId,
          draftsByThreadId: state.draftsByThreadId,
        });
        return {
          draftsByThreadId: cleanedDrafts.draftsByThreadId,
          draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: restProjectMappings,
        };
      });
    },
    markDraftThreadPromoting: (threadId, promotedTo) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftThreadsByThreadId[threadId];
        if (!existing) {
          return state;
        }
        const nextPromotedTo = promotedTo ?? threadId;
        if (existing.promotedTo === nextPromotedTo) {
          return state;
        }
        return {
          draftThreadsByThreadId: {
            ...state.draftThreadsByThreadId,
            [threadId]: {
              ...existing,
              promotedTo: nextPromotedTo,
            },
          },
        };
      });
    },
    finalizePromotedDraftThread: (threadId) => {
      const draftThread = get().draftThreadsByThreadId[threadId];
      if (!draftThread?.promotedTo) {
        return;
      }
      get().clearDraftThread(threadId);
    },
    clearDraftThread: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      const removedDraft = get().draftsByThreadId[threadId];
      revokeDraftPreviewUrls(removedDraft);
      deleteDraftComposerImageBlobs(removedDraft);
      set((state) => {
        const hasDraftThread = state.draftThreadsByThreadId[threadId] !== undefined;
        const hasProjectMapping = Object.values(state.projectDraftThreadIdByProjectId).includes(
          threadId,
        );
        const hasComposerDraft = state.draftsByThreadId[threadId] !== undefined;
        if (!hasDraftThread && !hasProjectMapping && !hasComposerDraft) {
          return state;
        }
        const nextProjectDraftThreadIdByProjectId = Object.fromEntries(
          Object.entries(state.projectDraftThreadIdByProjectId).filter(
            ([, draftThreadId]) => draftThreadId !== threadId,
          ),
        ) as Record<string, ThreadId>;
        const { [threadId]: _removedDraftThread, ...restDraftThreadsByThreadId } =
          state.draftThreadsByThreadId;
        const { [threadId]: _removedComposerDraft, ...restDraftsByThreadId } =
          state.draftsByThreadId;
        return {
          draftsByThreadId: restDraftsByThreadId,
          draftThreadsByThreadId: restDraftThreadsByThreadId,
          projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
        };
      });
    },
  };
}
