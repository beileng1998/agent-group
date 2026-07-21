// FILE: useSidebarThreadDeleteOwner.ts
// Purpose: Own sidebar thread deletion, cleanup, navigation fallback, and project-batch deletion.
// Layer: Web sidebar controller

import { ProjectId, ThreadId } from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import type { SidebarThreadSortOrder } from "../appSettings";
import { useComposerDraftStore } from "../composerDraftStore";
import { showConfirmDialogFallback } from "../confirmDialogFallback";
import { getFallbackThreadIdAfterDelete } from "../components/Sidebar.sortingLogic";
import { terminalRuntimeRegistry } from "../components/terminal/terminalRuntimeRegistry";
import { toastManager } from "../components/ui/toast";
import {
  reconcileDeletedThreadFromClient,
  reconcileDeletedThreadsFromClient,
} from "../lib/deletedThreadClientReconciliation";
import { gitRemoveWorktreeMutationOptions } from "../lib/gitReactQuery";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { usePinnedThreadsStore } from "../pinnedThreadsStore";
import {
  resolveSplitViewFocusedThreadId,
  resolveSplitViewPaneIdForThread,
  useSplitViewStore,
} from "../splitViewStore";
import { useStore } from "../store";
import { useTemporaryThreadStore } from "../temporaryThreadStore";
import { useTerminalStateStore } from "../terminalStateStore";
import { getThreadFromState, getThreadsFromState } from "../threadDerivation";
import { useThreadSelectionStore } from "../threadSelectionStore";
import type { Project, SidebarThreadSummary } from "../types";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { useHandleNewChat } from "./useHandleNewChat";

export interface DeleteProjectThreadsOptions {
  readonly confirmMessage?: string | null;
  readonly showEmptyToast?: boolean;
  readonly showResultToast?: boolean;
  readonly worktreeCleanupMode?: "prompt" | "skip";
}

export interface DeleteProjectThreadsResult {
  readonly deletedCount: number;
  readonly failureCount: number;
  readonly totalCount: number;
  readonly projectName: string;
}

interface UseSidebarThreadDeleteOwnerInput {
  readonly projects: readonly Project[];
  readonly sidebarThreads: readonly SidebarThreadSummary[];
  readonly sidebarThreadSummaryById: Readonly<Record<string, SidebarThreadSummary>>;
  readonly routeThreadId: ThreadId | null;
  readonly routeSplitViewId: string | null;
  readonly threadSortOrder: SidebarThreadSortOrder;
  readonly confirmThreadDelete: boolean;
}

export function useSidebarThreadDeleteOwner({
  projects,
  sidebarThreads,
  sidebarThreadSummaryById,
  routeThreadId,
  routeSplitViewId,
  threadSortOrder,
  confirmThreadDelete,
}: UseSidebarThreadDeleteOwnerInput) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { handleNewChat } = useHandleNewChat();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const clearDraftThread = useComposerDraftStore((state) => state.clearDraftThread);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (state) => state.clearProjectDraftThreadById,
  );
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const clearTemporaryThread = useTemporaryThreadStore((state) => state.clearTemporaryThread);
  const unpinThread = usePinnedThreadsStore((state) => state.unpinThread);
  const removeThreadFromSplitViews = useSplitViewStore((state) => state.removeThreadFromSplitViews);
  const removeFromSelection = useThreadSelectionStore((state) => state.removeFromSelection);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );

  const deleteThread = useCallback(
    async (
      threadId: ThreadId,
      options: {
        deletedThreadIds?: ReadonlySet<ThreadId>;
        reconcileDeletedThread?: boolean;
        worktreeCleanupMode?: "prompt" | "skip";
      } = {},
    ) => {
      const api = readNativeApi();
      if (!api) return;
      const state = useStore.getState();
      const thread = getThreadFromState(state, threadId);
      if (!thread) return;
      const threadProject = projectById.get(thread.projectId);
      const allThreads = getThreadsFromState(state);
      const deletedIds = options.deletedThreadIds;
      const survivingThreads =
        deletedIds && deletedIds.size > 0
          ? allThreads.filter(
              (candidate) => candidate.id === threadId || !deletedIds.has(candidate.id),
            )
          : allThreads;
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
      const shouldDeleteWorktree =
        (options.worktreeCleanupMode ?? "prompt") === "prompt" &&
        canDeleteWorktree &&
        (await api.dialogs.confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      try {
        terminalRuntimeRegistry.disposeThread(threadId);
        await api.terminal.close({ threadId, deleteHistory: true });
      } catch {
        // The terminal may already be closed.
      }

      const allDeletedIds = deletedIds ?? new Set<ThreadId>();
      const shouldNavigateToFallback = routeThreadId === threadId;
      const fallbackThreadId = getFallbackThreadIdAfterDelete({
        threads: sidebarThreads,
        deletedThreadId: threadId,
        deletedThreadIds: allDeletedIds,
        sortOrder: threadSortOrder,
      });
      const splitViewBeforeDelete = routeSplitViewId
        ? (useSplitViewStore.getState().splitViewsById[routeSplitViewId] ?? null)
        : null;
      const deletedPaneInActiveSplit = splitViewBeforeDelete
        ? resolveSplitViewPaneIdForThread(splitViewBeforeDelete, threadId)
        : null;

      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId,
      });
      if (options.reconcileDeletedThread ?? true) {
        void reconcileDeletedThreadFromClient({
          threadId,
          removeDeletedThreadFromClientState:
            useStore.getState().removeDeletedThreadFromClientState,
        });
      }
      unpinThread(threadId);
      clearDraftThread(threadId);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      clearTerminalState(threadId);
      removeThreadFromSplitViews(threadId);
      clearTemporaryThread(threadId);

      if (routeSplitViewId && deletedPaneInActiveSplit) {
        const nextSplitView = useSplitViewStore.getState().splitViewsById[routeSplitViewId] ?? null;
        const nextFocusedThreadId = nextSplitView
          ? resolveSplitViewFocusedThreadId(nextSplitView)
          : null;
        if (nextSplitView && nextFocusedThreadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: nextFocusedThreadId },
            replace: true,
            search: () => ({ splitViewId: nextSplitView.id }),
          });
        } else if (shouldNavigateToFallback && fallbackThreadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: fallbackThreadId },
            replace: true,
          });
        } else if (shouldNavigateToFallback) {
          void handleNewChat({ fresh: true });
        }
      } else if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: fallbackThreadId },
            replace: true,
          });
        } else {
          void handleNewChat({ fresh: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) return;
      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }
    },
    [
      clearDraftThread,
      clearProjectDraftThreadById,
      clearTemporaryThread,
      clearTerminalState,
      handleNewChat,
      navigate,
      projectById,
      removeThreadFromSplitViews,
      removeWorktreeMutation,
      routeSplitViewId,
      routeThreadId,
      sidebarThreads,
      threadSortOrder,
      unpinThread,
    ],
  );

  const confirmAndDeleteThread = useCallback(
    async (threadId: ThreadId) => {
      const thread = sidebarThreadSummaryById[threadId];
      if (!thread) return;
      if (confirmThreadDelete) {
        const message = [
          `Delete thread "${thread.title}"?`,
          "This permanently clears conversation history for this thread.",
        ].join("\n");
        const api = readNativeApi();
        const confirmed = api
          ? await api.dialogs.confirm(message)
          : await showConfirmDialogFallback(message);
        if (!confirmed) return;
      }
      await deleteThread(threadId);
    },
    [confirmThreadDelete, deleteThread, sidebarThreadSummaryById],
  );

  const deleteProjectThreads = useCallback(
    async (
      projectId: ProjectId,
      options?: DeleteProjectThreadsOptions,
    ): Promise<DeleteProjectThreadsResult | null> => {
      const api = readNativeApi();
      const project = projectById.get(projectId);
      if (!api || !project) return null;
      const projectThreads = sidebarThreads.filter((thread) => thread.projectId === projectId);
      if (projectThreads.length === 0) {
        if (options?.showEmptyToast ?? true) {
          toastManager.add({
            type: "info",
            title: "Nothing to delete",
            description: `"${project.name}" has no threads to delete.`,
          });
        }
        return { deletedCount: 0, failureCount: 0, totalCount: 0, projectName: project.name };
      }
      const confirmationMessage =
        options?.confirmMessage === undefined
          ? [
              `Delete ${projectThreads.length} ${pluralize(projectThreads.length, "thread")} in "${project.name}"?`,
              "This permanently clears conversation history for these threads.",
            ].join("\n")
          : options.confirmMessage;
      if (confirmationMessage !== null && !(await api.dialogs.confirm(confirmationMessage))) {
        return null;
      }

      const deletedIds = new Set(projectThreads.map((thread) => thread.id));
      const successfullyDeletedIds: ThreadId[] = [];
      let deletedCount = 0;
      let failureCount = 0;
      for (const thread of projectThreads) {
        try {
          await deleteThread(thread.id, {
            deletedThreadIds: deletedIds,
            reconcileDeletedThread: false,
            ...(options?.worktreeCleanupMode
              ? { worktreeCleanupMode: options.worktreeCleanupMode }
              : {}),
          });
          successfullyDeletedIds.push(thread.id);
          deletedCount += 1;
        } catch (error) {
          failureCount += 1;
          console.error("Failed to delete thread during bulk delete", {
            threadId: thread.id,
            projectId,
            error,
          });
        }
      }
      void reconcileDeletedThreadsFromClient({
        threadIds: successfullyDeletedIds,
        removeDeletedThreadFromClientState: useStore.getState().removeDeletedThreadFromClientState,
      });
      removeFromSelection([...deletedIds]);
      if (options?.showResultToast ?? true) {
        if (deletedCount > 0) {
          toastManager.add({
            type: failureCount > 0 ? "warning" : "success",
            title: deletedCount === 1 ? "Thread deleted" : `Deleted ${deletedCount} threads`,
            description:
              failureCount > 0
                ? `Failed to delete ${failureCount} ${pluralize(failureCount, "thread")}.`
                : `"${project.name}" cleared.`,
          });
        } else if (failureCount > 0) {
          toastManager.add({
            type: "error",
            title: "Failed to delete threads",
            description: `Could not delete ${failureCount} ${pluralize(failureCount, "thread")} in "${project.name}".`,
          });
        }
      }
      return {
        deletedCount,
        failureCount,
        totalCount: projectThreads.length,
        projectName: project.name,
      };
    },
    [deleteThread, projectById, removeFromSelection, sidebarThreads],
  );

  const deleteAllThreadsInProject = useCallback(
    async (projectId: ProjectId) => {
      await deleteProjectThreads(projectId);
    },
    [deleteProjectThreads],
  );

  return {
    deleteThread,
    confirmAndDeleteThread,
    deleteProjectThreads,
    deleteAllThreadsInProject,
  };
}
