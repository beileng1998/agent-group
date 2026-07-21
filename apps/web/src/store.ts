// FILE: store.ts
// Purpose: Normalizes orchestration snapshots into stable client state for the web app.
// Exports: Zustand store plus pure state transition helpers shared by runtime bootstrap flows.

import { Fragment, type ReactNode, createElement, useEffect } from "react";
import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  ThreadId,
} from "@agent-group/contracts";
import { create } from "zustand";
import type { Project, ThreadWorkspacePatch } from "./types";
import {
  applyOrchestrationEvents,
  applyOrchestrationEventsHotPath,
} from "./store/storeEventReduction";
import {
  removeDeletedProjectFromClientState,
  removeDeletedThreadFromClientState,
} from "./store/storeNormalizedState";
import {
  debouncedPersistState,
  persistState,
  readPersistedState,
  rememberProjectLocalNames,
  rememberProjectUiState,
} from "./store/storePersistence";
import type { AppState, ReadModelThread } from "./store/storeState";
import {
  applyShellEvent,
  syncServerReadModel,
  syncServerShellSnapshot,
  syncServerThreadDetail,
  syncServerThreadDetailHotPath,
} from "./store/storeSnapshotSync";
import {
  collapseProjectsExcept,
  markThreadUnread,
  markThreadVisited,
  renameProjectLocally,
  reorderProjects,
  setAllProjectsExpanded,
  setError,
  setProjectExpanded,
  setThreadWorkspace,
  toggleProject,
} from "./store/storeUiReducers";

export { EMPTY_THREAD_IDS } from "./store/storeState";
export type { AppState } from "./store/storeState";
export {
  removeDeletedProjectFromClientState,
  removeDeletedThreadFromClientState,
} from "./store/storeNormalizedState";
export {
  applyOrchestrationEvents,
  applyOrchestrationEventsHotPath,
} from "./store/storeEventReduction";
export {
  applyShellEvent,
  syncServerReadModel,
  syncServerShellSnapshot,
  syncServerThreadDetail,
  syncServerThreadDetailHotPath,
} from "./store/storeSnapshotSync";
export {
  collapseProjectsExcept,
  markThreadUnread,
  markThreadVisited,
  renameProjectLocally,
  reorderProjects,
  setAllProjectsExpanded,
  setError,
  setProjectExpanded,
  setThreadWorkspace,
  toggleProject,
} from "./store/storeUiReducers";

export function persistAppStateNow(state: AppState = useStore.getState()): void {
  persistState(state);
}

// ── Pure state transition functions ────────────────────────────────────

// ── Zustand store ────────────────────────────────────────────────────

interface AppStore extends AppState {
  syncServerShellSnapshot: (snapshot: OrchestrationShellSnapshot) => void;
  syncServerThreadDetail: (thread: ReadModelThread) => void;
  syncServerThreadDetailHotPath: (thread: ReadModelThread) => void;
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  applyShellEvent: (event: OrchestrationShellStreamEvent) => void;
  applyOrchestrationEvents: (events: ReadonlyArray<OrchestrationEvent>) => void;
  applyOrchestrationEventsHotPath: (events: ReadonlyArray<OrchestrationEvent>) => void;
  removeDeletedProjectFromClientState: (projectId: Project["id"]) => void;
  removeDeletedThreadFromClientState: (threadId: ThreadId) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId) => void;
  toggleProject: (projectId: Project["id"]) => void;
  setProjectExpanded: (projectId: Project["id"], expanded: boolean) => void;
  setAllProjectsExpanded: (expanded: boolean) => void;
  collapseProjectsExcept: (activeProjectId: Project["id"] | null) => void;
  reorderProjects: (draggedProjectId: Project["id"], targetProjectId: Project["id"]) => void;
  renameProjectLocally: (projectId: Project["id"], name: string | null) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadWorkspace: (threadId: ThreadId, patch: ThreadWorkspacePatch) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...readPersistedState(),
  syncServerShellSnapshot: (snapshot) => set((state) => syncServerShellSnapshot(state, snapshot)),
  syncServerThreadDetail: (thread) => set((state) => syncServerThreadDetail(state, thread)),
  syncServerThreadDetailHotPath: (thread) =>
    set((state) => syncServerThreadDetailHotPath(state, thread)),
  syncServerReadModel: (readModel) => set((state) => syncServerReadModel(state, readModel)),
  applyShellEvent: (event) => set((state) => applyShellEvent(state, event)),
  applyOrchestrationEvents: (events) => set((state) => applyOrchestrationEvents(state, events)),
  applyOrchestrationEventsHotPath: (events) =>
    set((state) =>
      applyOrchestrationEventsHotPath(state, events, {
        updateThreadArray: false,
        updateSidebarSummary: false,
      }),
    ),
  removeDeletedProjectFromClientState: (projectId) =>
    set((state) => removeDeletedProjectFromClientState(state, projectId)),
  removeDeletedThreadFromClientState: (threadId) =>
    set((state) => removeDeletedThreadFromClientState(state, threadId)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId) => set((state) => markThreadUnread(state, threadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  setAllProjectsExpanded: (expanded) => set((state) => setAllProjectsExpanded(state, expanded)),
  collapseProjectsExcept: (activeProjectId) =>
    set((state) => collapseProjectsExcept(state, activeProjectId)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set((state) => reorderProjects(state, draggedProjectId, targetProjectId)),
  renameProjectLocally: (projectId, name) => {
    set((state) => renameProjectLocally(state, projectId, name));
    persistAppStateNow();
  },
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadWorkspace: (threadId, patch) =>
    set((state) => setThreadWorkspace(state, threadId, patch)),
}));

// Persist state changes with debouncing to avoid localStorage thrashing
useStore.subscribe((state) => {
  rememberProjectUiState(state.projects);
  rememberProjectLocalNames(state.projects);
  debouncedPersistState.maybeExecute(state);
});

// Flush pending writes synchronously before page unload to prevent data loss.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    persistAppStateNow();
  });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    persistAppStateNow();
  }, []);
  return createElement(Fragment, null, children);
}
