// FILE: storeProjectThreadMetaEvents.ts
// Purpose: Reduce project lifecycle and thread metadata orchestration events.
// Layer: Web state event reducers

import type { OrchestrationEvent } from "@agent-group/contracts";
import { resolveThreadBranchRegressionGuard } from "@agent-group/shared/git";
import type { Thread } from "../types";
import {
  deepEqualJson,
  normalizeModelSelection,
  resolveCreateBranchFlowCompletedMerge,
} from "./storeEquality";
import {
  removeDeletedProjectFromClientState,
  removeDeletedThreadFromClientState,
} from "./storeNormalizedState";
import { upsertProjectFromReadModel } from "./storeProjectProjection";
import type { AppState, ApplyOrchestrationEventOptions } from "./storeState";
import { applyThreadUpdate } from "./storeTurnMutation";

export function reduceProjectThreadMetaEvent(
  state: AppState,
  event: OrchestrationEvent,
  options?: ApplyOrchestrationEventOptions,
): AppState | undefined {
  switch (event.type) {
    case "project.created":
      return upsertProjectFromReadModel(state, {
        id: event.payload.projectId,
        kind: event.payload.kind,
        title: event.payload.title,
        workspaceRoot: event.payload.workspaceRoot,
        defaultModelSelection: event.payload.defaultModelSelection,
        scripts: event.payload.scripts,
        isPinned: event.payload.isPinned ?? false,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
        deletedAt: null,
      });

    case "project.meta-updated": {
      const existingProject = state.projects.find(
        (project) => project.id === event.payload.projectId,
      );
      if (!existingProject) {
        return state;
      }
      return upsertProjectFromReadModel(state, {
        id: existingProject.id,
        kind: event.payload.kind ?? existingProject.kind,
        title: event.payload.title ?? existingProject.remoteName,
        workspaceRoot: event.payload.workspaceRoot ?? existingProject.cwd,
        defaultModelSelection:
          event.payload.defaultModelSelection !== undefined
            ? event.payload.defaultModelSelection
            : existingProject.defaultModelSelection,
        scripts: event.payload.scripts ?? existingProject.scripts,
        isPinned: event.payload.isPinned ?? existingProject.isPinned ?? false,
        createdAt: existingProject.createdAt ?? event.payload.updatedAt,
        updatedAt: event.payload.updatedAt,
        deletedAt: null,
      });
    }

    case "project.deleted": {
      return removeDeletedProjectFromClientState(state, event.payload.projectId);
    }

    case "thread.deleted":
      // Deletion is terminal for both active sidebar rows and archived settings rows.
      return removeDeletedThreadFromClientState(state, event.payload.threadId);

    case "thread.meta-updated":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const modelSelection =
            event.payload.modelSelection !== undefined
              ? normalizeModelSelection(event.payload.modelSelection, thread.modelSelection)
              : thread.modelSelection;
          const nextBranch =
            event.payload.branch !== undefined
              ? resolveThreadBranchRegressionGuard({
                  currentBranch: thread.branch,
                  nextBranch: event.payload.branch,
                })
              : thread.branch;
          const nextWorktreePath =
            event.payload.worktreePath !== undefined
              ? event.payload.worktreePath
              : thread.worktreePath;
          const nextAssociatedWorktreePath =
            event.payload.associatedWorktreePath !== undefined
              ? event.payload.associatedWorktreePath
              : (thread.associatedWorktreePath ?? null);
          const nextAssociatedWorktreeBranch =
            event.payload.associatedWorktreeBranch !== undefined
              ? event.payload.associatedWorktreeBranch
              : (thread.associatedWorktreeBranch ?? null);
          const nextAssociatedWorktreeRef =
            event.payload.associatedWorktreeRef !== undefined
              ? event.payload.associatedWorktreeRef
              : (thread.associatedWorktreeRef ?? null);
          const nextCreateBranchFlowCompleted = resolveCreateBranchFlowCompletedMerge({
            currentBranch: thread.branch,
            nextBranch,
            currentWorktreePath: thread.worktreePath,
            nextWorktreePath,
            currentAssociatedWorktreePath: thread.associatedWorktreePath,
            nextAssociatedWorktreePath,
            currentAssociatedWorktreeBranch: thread.associatedWorktreeBranch,
            nextAssociatedWorktreeBranch,
            currentAssociatedWorktreeRef: thread.associatedWorktreeRef,
            nextAssociatedWorktreeRef,
            currentCreateBranchFlowCompleted: thread.createBranchFlowCompleted,
            nextCreateBranchFlowCompleted: event.payload.createBranchFlowCompleted,
          });
          const nextUpdatedAt =
            (thread.updatedAt ?? thread.createdAt) > event.payload.updatedAt
              ? thread.updatedAt
              : event.payload.updatedAt;
          const cwdChanged = thread.worktreePath !== nextWorktreePath;

          if (
            (event.payload.title === undefined || event.payload.title === thread.title) &&
            modelSelection === thread.modelSelection &&
            (event.payload.envMode === undefined || event.payload.envMode === thread.envMode) &&
            nextBranch === thread.branch &&
            nextWorktreePath === thread.worktreePath &&
            nextAssociatedWorktreePath === (thread.associatedWorktreePath ?? null) &&
            nextAssociatedWorktreeBranch === (thread.associatedWorktreeBranch ?? null) &&
            nextAssociatedWorktreeRef === (thread.associatedWorktreeRef ?? null) &&
            nextCreateBranchFlowCompleted === (thread.createBranchFlowCompleted ?? false) &&
            (event.payload.isPinned === undefined ||
              event.payload.isPinned === (thread.isPinned ?? false)) &&
            (event.payload.parentThreadId === undefined ||
              (event.payload.parentThreadId ?? null) === (thread.parentThreadId ?? null)) &&
            (event.payload.forkSourceThreadId === undefined ||
              (event.payload.forkSourceThreadId ?? null) === (thread.forkSourceThreadId ?? null)) &&
            (event.payload.subagentAgentId === undefined ||
              (event.payload.subagentAgentId ?? null) === (thread.subagentAgentId ?? null)) &&
            (event.payload.subagentNickname === undefined ||
              (event.payload.subagentNickname ?? null) === (thread.subagentNickname ?? null)) &&
            (event.payload.subagentRole === undefined ||
              (event.payload.subagentRole ?? null) === (thread.subagentRole ?? null)) &&
            (event.payload.lastKnownPr === undefined ||
              deepEqualJson(event.payload.lastKnownPr ?? null, thread.lastKnownPr ?? null)) &&
            (event.payload.handoff === undefined ||
              (event.payload.handoff ?? null) === (thread.handoff ?? null)) &&
            (event.payload.pinnedMessages === undefined ||
              deepEqualJson(event.payload.pinnedMessages, thread.pinnedMessages ?? null)) &&
            (event.payload.threadMarkers === undefined ||
              deepEqualJson(event.payload.threadMarkers, thread.threadMarkers ?? null)) &&
            (event.payload.notes === undefined || event.payload.notes === (thread.notes ?? "")) &&
            nextUpdatedAt === thread.updatedAt
          ) {
            return thread;
          }

          return {
            ...thread,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            modelSelection,
            ...(event.payload.envMode !== undefined ? { envMode: event.payload.envMode } : {}),
            branch: nextBranch,
            worktreePath: nextWorktreePath,
            associatedWorktreePath: nextAssociatedWorktreePath,
            associatedWorktreeBranch: nextAssociatedWorktreeBranch,
            associatedWorktreeRef: nextAssociatedWorktreeRef,
            createBranchFlowCompleted: nextCreateBranchFlowCompleted,
            ...(event.payload.isPinned !== undefined ? { isPinned: event.payload.isPinned } : {}),
            ...(event.payload.parentThreadId !== undefined
              ? { parentThreadId: event.payload.parentThreadId }
              : {}),
            ...(event.payload.forkSourceThreadId !== undefined
              ? { forkSourceThreadId: event.payload.forkSourceThreadId }
              : {}),
            ...(event.payload.subagentAgentId !== undefined
              ? { subagentAgentId: event.payload.subagentAgentId }
              : {}),
            ...(event.payload.subagentNickname !== undefined
              ? { subagentNickname: event.payload.subagentNickname }
              : {}),
            ...(event.payload.subagentRole !== undefined
              ? { subagentRole: event.payload.subagentRole }
              : {}),
            ...(event.payload.lastKnownPr !== undefined
              ? { lastKnownPr: event.payload.lastKnownPr }
              : {}),
            ...(event.payload.handoff !== undefined ? { handoff: event.payload.handoff } : {}),
            ...(event.payload.pinnedMessages !== undefined
              ? {
                  pinnedMessages: event.payload.pinnedMessages as NonNullable<
                    Thread["pinnedMessages"]
                  >,
                }
              : {}),
            ...(event.payload.threadMarkers !== undefined
              ? {
                  threadMarkers: event.payload.threadMarkers as NonNullable<
                    Thread["threadMarkers"]
                  >,
                }
              : {}),
            ...(event.payload.notes !== undefined ? { notes: event.payload.notes } : {}),
            updatedAt: nextUpdatedAt,
            ...(cwdChanged ? { session: null } : {}),
          };
        },
        {
          ...options,
          updateThreadArray:
            options?.updateThreadArray !== false || event.payload.title !== undefined,
          updateSidebarSummary: true,
        },
      );
    default:
      return undefined;
  }
}
