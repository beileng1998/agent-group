// FILE: composerDraftThreadState.ts
// Purpose: Own draft-thread metadata, project-slot mappings, and equality rules.
// Layer: Web composer domain state

import { ProjectId, ThreadId } from "@agent-group/contracts";
import * as Equal from "effect/Equal";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ThreadPrimarySurface,
} from "../types";
import type { PersistedComposerDraftStoreState } from "./composerDraftContracts";
import type {
  DraftThreadCreatedAtMode,
  DraftThreadMutationOptions,
  DraftThreadState,
} from "./composerDraftState";

const TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX = "::terminal";

export function normalizeDraftThreadEntryPoint(
  value: unknown,
  fallback: ThreadPrimarySurface = "chat",
): ThreadPrimarySurface {
  return value === "terminal" ? "terminal" : value === "chat" ? "chat" : fallback;
}

export const EMPTY_PERSISTED_DRAFT_STORE_STATE = Object.freeze<PersistedComposerDraftStoreState>({
  draftsByThreadId: {},
  draftThreadsByThreadId: {},
  projectDraftThreadIdByProjectId: {},
  stickyModelSelectionByProvider: {},
  stickyActiveProvider: null,
});

export function projectDraftThreadMappingKey(
  projectId: ProjectId,
  entryPoint: ThreadPrimarySurface = "chat",
): string {
  return entryPoint === "terminal"
    ? `${projectId}${TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX}`
    : projectId;
}

export function projectDraftThreadEntryPointFromKey(key: string): ThreadPrimarySurface {
  return key.endsWith(TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX) ? "terminal" : "chat";
}

export function projectIdFromDraftThreadMappingKey(key: string): ProjectId {
  return (
    key.endsWith(TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX)
      ? key.slice(0, -TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX.length)
      : key
  ) as ProjectId;
}

export function resolveDraftThreadCreatedAt(input: {
  createdAt: string | undefined;
  existingThread: DraftThreadState | undefined;
  mode: DraftThreadCreatedAtMode;
}): string {
  if (input.createdAt === undefined) {
    return input.existingThread?.createdAt ?? new Date().toISOString();
  }
  if (input.mode === "preserve-existing-on-empty") {
    return input.createdAt || input.existingThread?.createdAt || new Date().toISOString();
  }
  return input.createdAt;
}

export function buildDraftThreadState(input: {
  projectId: ProjectId;
  existingThread?: DraftThreadState | undefined;
  options?: DraftThreadMutationOptions | undefined;
  createdAtMode: DraftThreadCreatedAtMode;
}): DraftThreadState {
  const { existingThread, options } = input;
  const nextWorktreePath =
    options?.worktreePath === undefined
      ? (existingThread?.worktreePath ?? null)
      : (options.worktreePath ?? null);
  const nextEntryPoint = normalizeDraftThreadEntryPoint(
    options?.entryPoint,
    existingThread?.entryPoint ?? "chat",
  );
  const nextIsTemporary =
    options?.isTemporary === true
      ? true
      : options?.isTemporary === false
        ? false
        : existingThread?.isTemporary === true;
  const nextPromotedTo = existingThread?.promotedTo;

  return {
    projectId: input.projectId,
    createdAt: resolveDraftThreadCreatedAt({
      createdAt: options?.createdAt,
      existingThread,
      mode: input.createdAtMode,
    }),
    runtimeMode: options?.runtimeMode ?? existingThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode:
      options?.interactionMode ?? existingThread?.interactionMode ?? DEFAULT_INTERACTION_MODE,
    entryPoint: nextEntryPoint,
    branch:
      options?.branch === undefined ? (existingThread?.branch ?? null) : (options.branch ?? null),
    worktreePath: nextWorktreePath,
    lastKnownPr:
      options?.lastKnownPr === undefined
        ? (existingThread?.lastKnownPr ?? null)
        : (options.lastKnownPr ?? null),
    envMode:
      options?.envMode ?? (nextWorktreePath ? "worktree" : (existingThread?.envMode ?? "local")),
    ...(nextIsTemporary ? { isTemporary: true } : {}),
    ...(nextPromotedTo ? { promotedTo: nextPromotedTo } : {}),
  };
}

export function draftThreadStatesEqual(
  left: DraftThreadState | undefined,
  right: DraftThreadState,
): boolean {
  if (!left) {
    return false;
  }

  return (
    left.projectId === right.projectId &&
    left.createdAt === right.createdAt &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode &&
    left.entryPoint === right.entryPoint &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    Equal.equals(left.lastKnownPr ?? null, right.lastKnownPr ?? null) &&
    left.envMode === right.envMode &&
    (left.isTemporary === true) === (right.isTemporary === true) &&
    left.promotedTo === right.promotedTo
  );
}

export function removeProjectDraftMappingsForThread(
  projectDraftThreadIdByProjectId: Record<string, ThreadId>,
  threadId: ThreadId,
): Record<string, ThreadId> {
  let nextProjectDraftThreadIdByProjectId = projectDraftThreadIdByProjectId;
  for (const [mappingKey, mappedThreadId] of Object.entries(projectDraftThreadIdByProjectId)) {
    if (mappedThreadId !== threadId) {
      continue;
    }
    if (nextProjectDraftThreadIdByProjectId === projectDraftThreadIdByProjectId) {
      nextProjectDraftThreadIdByProjectId = { ...projectDraftThreadIdByProjectId };
    }
    delete nextProjectDraftThreadIdByProjectId[mappingKey];
  }
  return nextProjectDraftThreadIdByProjectId;
}
