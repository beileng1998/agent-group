// FILE: storeSnapshotSync.ts
// Purpose: Reconcile shell snapshots, thread details, and full read models.
// Layer: Web state server synchronization

import type {
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
} from "@agent-group/contracts";
import { getThreadFromState, getThreadsFromState } from "../threadDerivation";
import type { SidebarThreadSummary } from "../types";
import { arraysShallowEqual, recordsShallowEqual } from "./storeEquality";
import { mergeReadModelThreadDetailWithLiveHotPath } from "./storeThreadHotPath";
import {
  normalizeThreadFromReadModel,
  normalizeThreadShellSnapshot,
} from "./storeThreadNormalization";
import {
  commitThreadProjection,
  removeDeletedProjectFromClientState,
  removeThreadState,
  retainThreadScopedRecord,
  writeThreadShellProjection,
  writeThreadState,
} from "./storeNormalizedState";
import {
  mapProjectsFromReadModel,
  mapProjectsFromShellSnapshot,
  upsertProjectFromShell,
} from "./storeProjectProjection";
import { rememberProjectLocalNames, rememberProjectUiState } from "./storePersistence";
import { buildSidebarThreadSummary } from "./storeSidebarProjection";
import type { AppState, ReadModelThread } from "./storeState";

export function syncServerShellSnapshot(
  state: AppState,
  snapshot: OrchestrationShellSnapshot,
): AppState {
  rememberProjectUiState(state.projects);
  rememberProjectLocalNames(state.projects);
  const deletedProjectIdsById = state.deletedProjectIdsById ?? {};
  const deletedThreadIdsById = state.deletedThreadIdsById ?? {};
  const snapshotThreads = snapshot.threads.filter(
    (thread) =>
      deletedProjectIdsById[thread.projectId] !== true && deletedThreadIdsById[thread.id] !== true,
  );
  const snapshotProjects = snapshot.projects.filter(
    (project) => deletedProjectIdsById[project.id] !== true,
  );
  const projects = mapProjectsFromShellSnapshot(snapshotProjects, state.projects);
  const nextThreadIds = new Set(snapshotThreads.map((thread) => thread.id));

  let normalizedState: AppState = {
    ...state,
    threadIds: [],
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    messageIdsByThreadId: retainThreadScopedRecord(state.messageIdsByThreadId, nextThreadIds),
    messageByThreadId: retainThreadScopedRecord(state.messageByThreadId, nextThreadIds),
    activityIdsByThreadId: retainThreadScopedRecord(state.activityIdsByThreadId, nextThreadIds),
    activityByThreadId: retainThreadScopedRecord(state.activityByThreadId, nextThreadIds),
    proposedPlanIdsByThreadId: retainThreadScopedRecord(
      state.proposedPlanIdsByThreadId,
      nextThreadIds,
    ),
    proposedPlanByThreadId: retainThreadScopedRecord(state.proposedPlanByThreadId, nextThreadIds),
    turnDiffIdsByThreadId: retainThreadScopedRecord(state.turnDiffIdsByThreadId, nextThreadIds),
    turnDiffSummaryByThreadId: retainThreadScopedRecord(
      state.turnDiffSummaryByThreadId,
      nextThreadIds,
    ),
  };

  for (const thread of snapshotThreads) {
    const previousThread = getThreadFromState(state, thread.id);
    normalizedState = writeThreadShellProjection(
      normalizedState,
      normalizeThreadShellSnapshot(thread, previousThread),
    );
  }

  const derivedThreads = getThreadsFromState(normalizedState);
  const threads = arraysShallowEqual(state.threads, derivedThreads)
    ? state.threads
    : derivedThreads;
  const nextSidebarThreadSummaryById = Object.fromEntries(
    threads.map((thread) => [
      thread.id,
      buildSidebarThreadSummary(thread, state.sidebarThreadSummaryById[thread.id]),
    ]),
  ) as Record<string, SidebarThreadSummary>;
  const sidebarThreadSummaryById = recordsShallowEqual(
    state.sidebarThreadSummaryById,
    nextSidebarThreadSummaryById,
  )
    ? state.sidebarThreadSummaryById
    : nextSidebarThreadSummaryById;

  return {
    ...normalizedState,
    projects,
    threads,
    sidebarThreadSummaryById,
    threadsHydrated: true,
  };
}

function syncServerThreadDetailWithOptions(
  state: AppState,
  thread: ReadModelThread,
  options?: {
    updateThreadArray?: boolean;
  },
): AppState {
  const previousThread =
    getThreadFromState(state, thread.id) ?? state.threads.find((entry) => entry.id === thread.id);
  const nextThreadDetail =
    options?.updateThreadArray === false
      ? mergeReadModelThreadDetailWithLiveHotPath(thread, previousThread)
      : thread;
  return commitThreadProjection(
    writeThreadState(
      state,
      normalizeThreadFromReadModel(nextThreadDetail, previousThread),
      previousThread,
    ),
    thread.id,
    {
      updateThreadArray: options?.updateThreadArray ?? true,
      updateSidebarSummary: false,
    },
  );
}

export function syncServerThreadDetail(state: AppState, thread: ReadModelThread): AppState {
  if (
    state.deletedProjectIdsById?.[thread.projectId] === true ||
    state.deletedThreadIdsById?.[thread.id] === true
  ) {
    return removeThreadState(state, thread.id);
  }
  return syncServerThreadDetailWithOptions(state, thread, { updateThreadArray: true });
}

export function syncServerThreadDetailHotPath(state: AppState, thread: ReadModelThread): AppState {
  if (
    state.deletedProjectIdsById?.[thread.projectId] === true ||
    state.deletedThreadIdsById?.[thread.id] === true
  ) {
    return removeThreadState(state, thread.id);
  }
  return syncServerThreadDetailWithOptions(state, thread, { updateThreadArray: false });
}

export function applyShellEvent(state: AppState, event: OrchestrationShellStreamEvent): AppState {
  switch (event.kind) {
    case "project-upserted":
      return upsertProjectFromShell(state, event.project);
    case "project-removed":
      return removeDeletedProjectFromClientState(state, event.projectId);
    case "thread-upserted": {
      if (
        state.deletedProjectIdsById?.[event.thread.projectId] === true ||
        state.deletedThreadIdsById?.[event.thread.id] === true
      ) {
        return removeThreadState(state, event.thread.id);
      }
      const nextState = writeThreadShellProjection(
        state,
        normalizeThreadShellSnapshot(event.thread, getThreadFromState(state, event.thread.id)),
      );
      return commitThreadProjection(nextState, event.thread.id);
    }
    case "thread-removed":
      // Shell removals can be retryable draft rollbacks; explicit delete reconciliation owns tombstones.
      return removeThreadState(state, event.threadId);
  }
}

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  rememberProjectUiState(state.projects);
  rememberProjectLocalNames(state.projects);
  const deletedProjectIdsById = state.deletedProjectIdsById ?? {};
  const deletedThreadIdsById = state.deletedThreadIdsById ?? {};
  const projects = mapProjectsFromReadModel(
    readModel.projects.filter(
      (project) => project.deletedAt === null && deletedProjectIdsById[project.id] !== true,
    ),
    state.projects,
  );
  const existingThreadById = new Map(state.threads.map((thread) => [thread.id, thread] as const));
  const nextThreads = readModel.threads
    .filter(
      (thread) =>
        thread.deletedAt === null &&
        deletedProjectIdsById[thread.projectId] !== true &&
        deletedThreadIdsById[thread.id] !== true,
    )
    .map((thread) => {
      const existing = existingThreadById.get(thread.id);
      return normalizeThreadFromReadModel(thread, existing);
    });
  const nextThreadIds = new Set(nextThreads.map((thread) => thread.id));
  let normalizedState: AppState = {
    ...state,
    threadIds: [],
    threadShellById: retainThreadScopedRecord(state.threadShellById, nextThreadIds),
    threadSessionById: retainThreadScopedRecord(state.threadSessionById, nextThreadIds),
    threadTurnStateById: retainThreadScopedRecord(state.threadTurnStateById, nextThreadIds),
    messageIdsByThreadId: retainThreadScopedRecord(state.messageIdsByThreadId, nextThreadIds),
    messageByThreadId: retainThreadScopedRecord(state.messageByThreadId, nextThreadIds),
    activityIdsByThreadId: retainThreadScopedRecord(state.activityIdsByThreadId, nextThreadIds),
    activityByThreadId: retainThreadScopedRecord(state.activityByThreadId, nextThreadIds),
    proposedPlanIdsByThreadId: retainThreadScopedRecord(
      state.proposedPlanIdsByThreadId,
      nextThreadIds,
    ),
    proposedPlanByThreadId: retainThreadScopedRecord(state.proposedPlanByThreadId, nextThreadIds),
    turnDiffIdsByThreadId: retainThreadScopedRecord(state.turnDiffIdsByThreadId, nextThreadIds),
    turnDiffSummaryByThreadId: retainThreadScopedRecord(
      state.turnDiffSummaryByThreadId,
      nextThreadIds,
    ),
  };
  for (const thread of nextThreads) {
    normalizedState = writeThreadState(normalizedState, thread);
  }
  const derivedThreads = getThreadsFromState(normalizedState);
  const threads = arraysShallowEqual(state.threads, derivedThreads)
    ? state.threads
    : derivedThreads;
  const nextSidebarThreadSummaryById = Object.fromEntries(
    threads.map((thread) => [
      thread.id,
      buildSidebarThreadSummary(thread, state.sidebarThreadSummaryById[thread.id]),
    ]),
  ) as Record<string, SidebarThreadSummary>;
  const sidebarThreadSummaryById = recordsShallowEqual(
    state.sidebarThreadSummaryById,
    nextSidebarThreadSummaryById,
  )
    ? state.sidebarThreadSummaryById
    : nextSidebarThreadSummaryById;
  if (
    projects === state.projects &&
    threads === state.threads &&
    sidebarThreadSummaryById === state.sidebarThreadSummaryById &&
    normalizedState.threadIds === state.threadIds &&
    normalizedState.threadShellById === state.threadShellById &&
    normalizedState.threadSessionById === state.threadSessionById &&
    normalizedState.threadTurnStateById === state.threadTurnStateById &&
    normalizedState.messageIdsByThreadId === state.messageIdsByThreadId &&
    normalizedState.messageByThreadId === state.messageByThreadId &&
    normalizedState.activityIdsByThreadId === state.activityIdsByThreadId &&
    normalizedState.activityByThreadId === state.activityByThreadId &&
    normalizedState.proposedPlanIdsByThreadId === state.proposedPlanIdsByThreadId &&
    normalizedState.proposedPlanByThreadId === state.proposedPlanByThreadId &&
    normalizedState.turnDiffIdsByThreadId === state.turnDiffIdsByThreadId &&
    normalizedState.turnDiffSummaryByThreadId === state.turnDiffSummaryByThreadId &&
    state.threadsHydrated
  ) {
    return state;
  }
  return {
    ...normalizedState,
    projects,
    threads,
    sidebarThreadSummaryById,
    threadsHydrated: true,
  };
}
