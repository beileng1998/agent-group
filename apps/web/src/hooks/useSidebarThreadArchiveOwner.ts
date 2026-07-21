// FILE: useSidebarThreadArchiveOwner.ts
// Purpose: Own sidebar thread archive, undo, confirmation, and project-batch lifecycle.
// Layer: Web sidebar controller

import { ProjectId, ThreadId } from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef } from "react";
import type { SidebarThreadSortOrder } from "../appSettings";
import { showConfirmDialogFallback } from "../confirmDialogFallback";
import { getFallbackThreadIdAfterDelete } from "../components/Sidebar.sortingLogic";
import { toastManager } from "../components/ui/toast";
import {
  archiveThreadFromClient,
  isThreadAlreadyUnarchivedError,
  unarchiveThreadFromClient,
} from "../lib/threadArchive";
import { randomUUID } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { isThreadRunningTurn } from "../session-logic";
import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";
import { useThreadSelectionStore } from "../threadSelectionStore";
import type { Project, SidebarThreadSummary } from "../types";
import { useHandleNewChat } from "./useHandleNewChat";

const ARCHIVE_UNDO_TOAST_DURATION_MS = 8000;

interface UseSidebarThreadArchiveOwnerInput {
  readonly projects: readonly Project[];
  readonly sidebarThreads: readonly SidebarThreadSummary[];
  readonly sidebarThreadSummaryById: Readonly<Record<string, SidebarThreadSummary>>;
  readonly routeThreadId: ThreadId | null;
  readonly threadSortOrder: SidebarThreadSortOrder;
  readonly confirmThreadArchive: boolean;
}

export function useSidebarThreadArchiveOwner({
  projects,
  sidebarThreads,
  sidebarThreadSummaryById,
  routeThreadId,
  threadSortOrder,
  confirmThreadArchive,
}: UseSidebarThreadArchiveOwnerInput) {
  const navigate = useNavigate();
  const { handleNewChat } = useHandleNewChat();
  const removeFromSelection = useThreadSelectionStore((state) => state.removeFromSelection);
  const archivePendingThreadIdsRef = useRef(new Set<ThreadId>());
  const archiveUndoPendingThreadIdsRef = useRef(new Set<ThreadId>());

  const archiveThread = useCallback(
    async (threadId: ThreadId): Promise<boolean> => {
      const api = readNativeApi();
      if (!api) return false;
      const thread = getThreadFromState(useStore.getState(), threadId);
      if (!thread) return false;
      if (isThreadRunningTurn(thread)) {
        toastManager.add({
          type: "error",
          title: "Cannot archive",
          description: "Stop the running session before archiving this thread.",
        });
        return false;
      }
      const pendingThreadIds = archivePendingThreadIdsRef.current;
      if (pendingThreadIds.has(threadId)) return false;
      pendingThreadIds.add(threadId);
      try {
        await archiveThreadFromClient(api.orchestration, threadId);
        if (routeThreadId === threadId) {
          const fallbackThreadId = getFallbackThreadIdAfterDelete({
            threads: sidebarThreads,
            deletedThreadId: threadId,
            deletedThreadIds: new Set<ThreadId>(),
            sortOrder: threadSortOrder,
          });
          if (fallbackThreadId) {
            await navigate({
              to: "/$threadId",
              params: { threadId: fallbackThreadId },
              replace: true,
            });
          } else {
            await handleNewChat({ fresh: true });
          }
        }
        return true;
      } finally {
        pendingThreadIds.delete(threadId);
      }
    },
    [handleNewChat, navigate, routeThreadId, sidebarThreads, threadSortOrder],
  );

  const restoreArchivedThread = useCallback(
    async (input: { threadId: ThreadId; returnToThreadOnUndo: boolean }): Promise<boolean> => {
      const pendingThreadIds = archiveUndoPendingThreadIdsRef.current;
      if (pendingThreadIds.has(input.threadId)) return false;
      pendingThreadIds.add(input.threadId);
      try {
        const currentThread = getThreadFromState(useStore.getState(), input.threadId);
        if (!currentThread) {
          toastManager.add({
            type: "error",
            title: "Could not restore thread",
            description: "The thread no longer exists.",
          });
          return false;
        }
        try {
          const api = readNativeApi();
          if (!api) throw new Error("Unable to connect to the app server.");
          await unarchiveThreadFromClient(api.orchestration, input.threadId);
        } catch (error) {
          if (!isThreadAlreadyUnarchivedError(error, input.threadId)) throw error;
        }
        if (input.returnToThreadOnUndo) {
          void navigate({
            to: "/$threadId",
            params: { threadId: input.threadId },
            replace: true,
          });
        }
        return true;
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not restore thread",
          description: error instanceof Error ? error.message : "Unable to restore the thread.",
        });
        return false;
      } finally {
        pendingThreadIds.delete(input.threadId);
      }
    },
    [navigate],
  );

  const showArchiveUndoToast = useCallback(
    (threadId: ThreadId, options?: { returnToThreadOnUndo?: boolean }) => {
      toastManager.add({
        id: `archive-undo:${threadId}:${randomUUID()}`,
        timeout: 0,
        data: {
          allowCrossThreadVisibility: true,
          dismissAfterVisibleMs: ARCHIVE_UNDO_TOAST_DURATION_MS,
          archiveUndo: {
            onUndo: () =>
              restoreArchivedThread({
                threadId,
                returnToThreadOnUndo: options?.returnToThreadOnUndo === true,
              }),
            onViewArchived: () => {
              void navigate({ to: "/settings", search: { section: "archived" } });
            },
          },
        },
      });
    },
    [navigate, restoreArchivedThread],
  );

  const archiveThreadWithUndo = useCallback(
    async (threadId: ThreadId) => {
      try {
        const returnToThreadOnUndo = routeThreadId === threadId;
        if (await archiveThread(threadId)) {
          showArchiveUndoToast(threadId, { returnToThreadOnUndo });
        }
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not archive thread",
          description: error instanceof Error ? error.message : "Unable to archive the thread.",
        });
      }
    },
    [archiveThread, routeThreadId, showArchiveUndoToast],
  );

  const confirmAndArchiveThread = useCallback(
    async (threadId: ThreadId) => {
      const thread = sidebarThreadSummaryById[threadId];
      if (!thread) return;
      if (confirmThreadArchive) {
        const message = [
          `Archive thread "${thread.title}"?`,
          "Archived threads are hidden from the sidebar but can be restored later.",
        ].join("\n");
        const api = readNativeApi();
        const confirmed = api
          ? await api.dialogs.confirm(message)
          : await showConfirmDialogFallback(message);
        if (!confirmed) return;
      }
      await archiveThreadWithUndo(threadId);
    },
    [archiveThreadWithUndo, confirmThreadArchive, sidebarThreadSummaryById],
  );

  const archiveAllThreadsInProject = useCallback(
    async (projectId: ProjectId) => {
      const api = readNativeApi();
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!api || !project) return;
      const projectThreads = sidebarThreads.filter(
        (thread) => thread.projectId === projectId && thread.archivedAt == null,
      );
      if (projectThreads.length === 0) {
        toastManager.add({
          type: "info",
          title: "Nothing to archive",
          description: `"${project.name}" has no threads to archive.`,
        });
        return;
      }
      const archivableThreads = projectThreads.filter((thread) => !isThreadRunningTurn(thread));
      const runningCount = projectThreads.length - archivableThreads.length;
      if (archivableThreads.length === 0) {
        toastManager.add({
          type: "error",
          title: "Cannot archive threads",
          description:
            runningCount === 1
              ? "The only thread in this project is running. Stop it before archiving."
              : `All ${runningCount} threads in this project are running. Stop them before archiving.`,
        });
        return;
      }
      const lines = [
        `Archive ${archivableThreads.length} ${pluralize(archivableThreads.length, "thread")} in "${project.name}"?`,
        "Archived threads are hidden from the sidebar but can be restored later.",
      ];
      if (runningCount > 0) {
        lines.push(
          "",
          `${runningCount} running ${pluralize(runningCount, "thread is", "threads are")} currently active and will be skipped.`,
        );
      }
      if (!(await api.dialogs.confirm(lines.join("\n")))) return;
      let archivedCount = 0;
      let failureCount = 0;
      for (const thread of archivableThreads) {
        try {
          if (await archiveThread(thread.id)) archivedCount += 1;
          else failureCount += 1;
        } catch (error) {
          failureCount += 1;
          console.error("Failed to archive thread during bulk archive", {
            threadId: thread.id,
            projectId,
            error,
          });
        }
      }
      removeFromSelection(archivableThreads.map((thread) => thread.id));
      if (archivedCount > 0) {
        const skipped =
          runningCount > 0
            ? ` Skipped ${runningCount} running ${pluralize(runningCount, "thread")}.`
            : "";
        toastManager.add({
          type: failureCount > 0 ? "warning" : "success",
          title: archivedCount === 1 ? "Thread archived" : `Archived ${archivedCount} threads`,
          description:
            failureCount > 0
              ? `Failed to archive ${failureCount} ${pluralize(failureCount, "thread")}.${skipped}`
              : runningCount > 0
                ? skipped.trim()
                : `"${project.name}" cleared.`,
        });
      } else if (failureCount > 0) {
        toastManager.add({
          type: "error",
          title: "Failed to archive threads",
          description: `Could not archive ${failureCount} ${pluralize(failureCount, "thread")} in "${project.name}".`,
        });
      }
    },
    [archiveThread, projects, removeFromSelection, sidebarThreads],
  );

  return {
    archiveThread,
    archiveThreadWithUndo,
    confirmAndArchiveThread,
    archiveAllThreadsInProject,
  };
}
