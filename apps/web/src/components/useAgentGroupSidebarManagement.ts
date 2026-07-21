import type { ProjectId, ThreadId } from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { deleteProjectFromClient } from "~/lib/projectDelete";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useRightDockStore } from "~/rightDockStore";
import { useStore } from "~/store";
import type { Project, SidebarThreadSummary } from "~/types";
import { toastManager } from "./ui/toast";

export function useAgentGroupSidebarManagement(input: {
  activeGroupId: ProjectId | null;
  activeThreadId: string | null;
  forgetGroup: (groupId: ProjectId) => void;
  forgetSession: (groupId: ProjectId, sessionId: ThreadId) => void;
  groups: readonly Project[];
  navigateThread: (threadId: ThreadId) => void;
  reorderSessions: (
    groupId: ProjectId,
    sessions: readonly SidebarThreadSummary[],
    draggedId: ThreadId,
    targetId: ThreadId,
  ) => void;
  sessionsByGroup: ReadonlyMap<ProjectId, SidebarThreadSummary[]>;
  threadSummaries: Readonly<Record<string, SidebarThreadSummary>>;
}) {
  const {
    activeGroupId,
    activeThreadId,
    forgetGroup,
    forgetSession,
    groups,
    navigateThread,
    reorderSessions,
    sessionsByGroup,
    threadSummaries,
  } = input;
  const navigate = useNavigate();
  const syncServerShellSnapshot = useStore((state) => state.syncServerShellSnapshot);
  const reorderProjects = useStore((state) => state.reorderProjects);
  const removeDeletedProjectFromClientState = useStore(
    (state) => state.removeDeletedProjectFromClientState,
  );
  const removeDeletedThreadFromClientState = useStore(
    (state) => state.removeDeletedThreadFromClientState,
  );

  const toggleGroupPin = useCallback(
    async (group: Project) => {
      const api = readNativeApi();
      if (!api) return;
      try {
        await api.orchestration.dispatchCommand({
          type: "project.meta.update",
          commandId: newCommandId(),
          projectId: group.id,
          isPinned: group.isPinned !== true,
        });
        syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
      } catch (error) {
        toastManager.add({
          type: "error",
          title: group.isPinned ? "Could not unpin group" : "Could not pin group",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [syncServerShellSnapshot],
  );

  const toggleSessionPin = useCallback(
    async (session: SidebarThreadSummary) => {
      const api = readNativeApi();
      if (!api) return;
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: session.id,
          isPinned: session.isPinned !== true,
        });
        syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
      } catch (error) {
        toastManager.add({
          type: "error",
          title: session.isPinned ? "Could not unpin session" : "Could not pin session",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [syncServerShellSnapshot],
  );

  const deleteSession = useCallback(
    async (session: SidebarThreadSummary) => {
      const api = readNativeApi();
      if (!api) return;
      const hasChildren = Object.values(threadSummaries).some(
        (candidate) => candidate.parentThreadId === session.id,
      );
      const confirmed = await api.dialogs.confirm(
        [
          `Delete session "${session.title}"?`,
          "This permanently clears its conversation history.",
          ...(hasChildren ? ["Child sessions will remain in the group."] : []),
        ].join("\n"),
      );
      if (!confirmed) return;

      try {
        await api.orchestration.dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: session.id,
        });
        removeDeletedThreadFromClientState(session.id);
        useRightDockStore.getState().clearThreadDockState(session.id);
        forgetSession(session.projectId, session.id);

        if (activeThreadId === session.id) {
          const sameGroupFallback = (sessionsByGroup.get(session.projectId) ?? []).find(
            (candidate) => candidate.id !== session.id,
          );
          const fallback =
            sameGroupFallback ??
            groups
              .flatMap((group) => sessionsByGroup.get(group.id) ?? [])
              .find((candidate) => candidate.id !== session.id);
          if (fallback) navigateThread(fallback.id);
          else void navigate({ to: "/", replace: true });
        }

        toastManager.add({ type: "success", title: "Session deleted" });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not delete session",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [
      activeThreadId,
      forgetSession,
      groups,
      navigate,
      navigateThread,
      removeDeletedThreadFromClientState,
      sessionsByGroup,
      threadSummaries,
    ],
  );

  const deleteGroup = useCallback(
    async (group: Project) => {
      const api = readNativeApi();
      if (!api) return;
      const sessions = Object.values(threadSummaries).filter(
        (session) => session.projectId === group.id,
      );
      const confirmed = await api.dialogs.confirm(
        [
          `Delete group "${group.remoteName || group.name}"?`,
          sessions.length > 0
            ? `This permanently deletes ${sessions.length} session${sessions.length === 1 ? "" : "s"} and their conversation history.`
            : "This removes the group from Agent Group.",
          "The workspace folder and its files will not be deleted.",
        ].join("\n"),
      );
      if (!confirmed) return;

      let deletedSessions = 0;
      try {
        for (const session of sessions) {
          await api.orchestration.dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: session.id,
          });
          removeDeletedThreadFromClientState(session.id);
          useRightDockStore.getState().clearThreadDockState(session.id);
          forgetSession(group.id, session.id);
          deletedSessions += 1;
        }
        await deleteProjectFromClient({
          api: api.orchestration,
          projectId: group.id,
          removeDeletedProjectFromClientState,
        });
        forgetGroup(group.id);
        if (activeGroupId === group.id) void navigate({ to: "/", replace: true });
        toastManager.add({ type: "success", title: "Group deleted" });
      } catch (error) {
        if (activeGroupId === group.id && deletedSessions > 0) {
          void navigate({ to: "/", replace: true });
        }
        toastManager.add({
          type: "error",
          title: "Could not delete group",
          description:
            deletedSessions > 0
              ? `${deletedSessions} session${deletedSessions === 1 ? " was" : "s were"} deleted before the operation stopped.`
              : error instanceof Error
                ? error.message
                : undefined,
        });
      }
    },
    [
      activeGroupId,
      forgetGroup,
      forgetSession,
      navigate,
      removeDeletedProjectFromClientState,
      removeDeletedThreadFromClientState,
      threadSummaries,
    ],
  );

  const reorderGroup = useCallback(
    (draggedId: ProjectId, targetId: ProjectId) => {
      const dragged = groups.find((group) => group.id === draggedId);
      const target = groups.find((group) => group.id === targetId);
      if (!dragged || !target || Boolean(dragged.isPinned) !== Boolean(target.isPinned)) return;
      reorderProjects(draggedId, targetId);
    },
    [groups, reorderProjects],
  );

  const reorderSession = useCallback(
    (groupId: ProjectId, draggedId: ThreadId, targetId: ThreadId) => {
      const sessions = sessionsByGroup.get(groupId) ?? [];
      const dragged = sessions.find((session) => session.id === draggedId);
      const target = sessions.find((session) => session.id === targetId);
      if (
        !dragged ||
        !target ||
        (dragged.isPinned ? null : (dragged.parentThreadId ?? null)) !==
          (target.isPinned ? null : (target.parentThreadId ?? null)) ||
        Boolean(dragged.isPinned) !== Boolean(target.isPinned)
      ) {
        return;
      }
      reorderSessions(groupId, sessions, draggedId, targetId);
    },
    [reorderSessions, sessionsByGroup],
  );

  return {
    deleteGroup,
    deleteSession,
    reorderGroup,
    reorderSession,
    toggleGroupPin,
    toggleSessionPin,
  };
}
