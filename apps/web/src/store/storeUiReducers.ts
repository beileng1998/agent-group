// FILE: storeUiReducers.ts
// Purpose: Own local project, visit, error, and workspace state transitions.
// Layer: Web state UI reducers

import type { ThreadId } from "@agent-group/contracts";
import { resolveThreadBranchRegressionGuard } from "@agent-group/shared/git";
import type { Project, ThreadWorkspacePatch } from "../types";
import { resolveCreateBranchFlowCompletedMerge } from "./storeEquality";
import type { AppState } from "./storeState";
import { applyThreadUpdate } from "./storeTurnMutation";

export function markThreadVisited(
  state: AppState,
  threadId: ThreadId,
  visitedAt?: string,
): AppState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  return applyThreadUpdate(state, threadId, (thread) => {
    const previousVisitedAtMs = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : NaN;
    if (
      Number.isFinite(previousVisitedAtMs) &&
      Number.isFinite(visitedAtMs) &&
      previousVisitedAtMs >= visitedAtMs
    ) {
      return thread;
    }
    return { ...thread, lastVisitedAt: at };
  });
}

export function markThreadUnread(state: AppState, threadId: ThreadId): AppState {
  return applyThreadUpdate(state, threadId, (thread) => {
    if (!thread.latestTurn?.completedAt) return thread;
    const latestTurnCompletedAtMs = Date.parse(thread.latestTurn.completedAt);
    if (Number.isNaN(latestTurnCompletedAtMs)) return thread;
    const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
    if (thread.lastVisitedAt === unreadVisitedAt) return thread;
    return { ...thread, lastVisitedAt: unreadVisitedAt };
  });
}

export function toggleProject(state: AppState, projectId: Project["id"]): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === projectId ? { ...p, expanded: !p.expanded } : p)),
  };
}

export function setProjectExpanded(
  state: AppState,
  projectId: Project["id"],
  expanded: boolean,
): AppState {
  let changed = false;
  const projects = state.projects.map((p) => {
    if (p.id !== projectId || p.expanded === expanded) return p;
    changed = true;
    return { ...p, expanded };
  });
  return changed ? { ...state, projects } : state;
}

export function setAllProjectsExpanded(state: AppState, expanded: boolean): AppState {
  let changed = false;
  const projects = state.projects.map((project) => {
    if (project.expanded === expanded) return project;
    changed = true;
    return { ...project, expanded };
  });
  return changed ? { ...state, projects } : state;
}

// Keep just one project expanded so bulk collapse preserves the active chat context.
export function collapseProjectsExcept(
  state: AppState,
  activeProjectId: Project["id"] | null,
): AppState {
  let changed = false;
  const projects = state.projects.map((project) => {
    const nextExpanded = activeProjectId !== null && project.id === activeProjectId;
    if (project.expanded === nextExpanded) return project;
    changed = true;
    return { ...project, expanded: nextExpanded };
  });
  return changed ? { ...state, projects } : state;
}

export function reorderProjects(
  state: AppState,
  draggedProjectId: Project["id"],
  targetProjectId: Project["id"],
): AppState {
  if (draggedProjectId === targetProjectId) return state;
  const draggedIndex = state.projects.findIndex((project) => project.id === draggedProjectId);
  const targetIndex = state.projects.findIndex((project) => project.id === targetProjectId);
  if (draggedIndex < 0 || targetIndex < 0) return state;
  const projects = [...state.projects];
  const [draggedProject] = projects.splice(draggedIndex, 1);
  if (!draggedProject) return state;
  projects.splice(targetIndex, 0, draggedProject);
  return { ...state, projects };
}

export function renameProjectLocally(
  state: AppState,
  projectId: Project["id"],
  name: string | null,
): AppState {
  const normalizedName = name?.trim() ?? null;
  let changed = false;
  const projects = state.projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }
    const nextLocalName = normalizedName && normalizedName.length > 0 ? normalizedName : null;
    const nextName = nextLocalName ?? project.remoteName;
    if (project.localName === nextLocalName && project.name === nextName) {
      return project;
    }
    changed = true;
    return {
      ...project,
      name: nextName,
      localName: nextLocalName,
    };
  });
  return changed ? { ...state, projects } : state;
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  return applyThreadUpdate(state, threadId, (thread) => {
    if (thread.error === error) return thread;
    return { ...thread, error };
  });
}

export function setThreadWorkspace(
  state: AppState,
  threadId: ThreadId,
  patch: ThreadWorkspacePatch,
): AppState {
  return applyThreadUpdate(state, threadId, (t) => {
    const nextEnvMode = patch.envMode !== undefined ? patch.envMode : t.envMode;
    const nextBranch = resolveThreadBranchRegressionGuard({
      currentBranch: t.branch,
      nextBranch: patch.branch !== undefined ? patch.branch : t.branch,
    });
    const nextWorktreePath = patch.worktreePath !== undefined ? patch.worktreePath : t.worktreePath;
    const nextAssociatedWorktreePath =
      patch.associatedWorktreePath !== undefined
        ? patch.associatedWorktreePath
        : (t.associatedWorktreePath ?? null);
    const nextAssociatedWorktreeBranch =
      patch.associatedWorktreeBranch !== undefined
        ? patch.associatedWorktreeBranch
        : (t.associatedWorktreeBranch ?? null);
    const nextAssociatedWorktreeRef =
      patch.associatedWorktreeRef !== undefined
        ? patch.associatedWorktreeRef
        : (t.associatedWorktreeRef ?? null);
    const nextCreateBranchFlowCompleted = resolveCreateBranchFlowCompletedMerge({
      currentBranch: t.branch,
      nextBranch,
      currentWorktreePath: t.worktreePath,
      nextWorktreePath,
      currentAssociatedWorktreePath: t.associatedWorktreePath,
      nextAssociatedWorktreePath,
      currentAssociatedWorktreeBranch: t.associatedWorktreeBranch,
      nextAssociatedWorktreeBranch,
      currentAssociatedWorktreeRef: t.associatedWorktreeRef,
      nextAssociatedWorktreeRef,
      currentCreateBranchFlowCompleted: t.createBranchFlowCompleted,
      nextCreateBranchFlowCompleted: patch.createBranchFlowCompleted,
    });
    if (
      t.envMode === nextEnvMode &&
      t.branch === nextBranch &&
      t.worktreePath === nextWorktreePath &&
      (t.associatedWorktreePath ?? null) === nextAssociatedWorktreePath &&
      (t.associatedWorktreeBranch ?? null) === nextAssociatedWorktreeBranch &&
      (t.associatedWorktreeRef ?? null) === nextAssociatedWorktreeRef &&
      (t.createBranchFlowCompleted ?? false) === nextCreateBranchFlowCompleted
    ) {
      return t;
    }
    const cwdChanged = t.worktreePath !== nextWorktreePath;
    return {
      ...t,
      envMode: nextEnvMode,
      branch: nextBranch,
      worktreePath: nextWorktreePath,
      associatedWorktreePath: nextAssociatedWorktreePath,
      associatedWorktreeBranch: nextAssociatedWorktreeBranch,
      associatedWorktreeRef: nextAssociatedWorktreeRef,
      createBranchFlowCompleted: nextCreateBranchFlowCompleted,
      ...(cwdChanged ? { session: null } : {}),
    };
  });
}
