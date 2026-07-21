// FILE: useSidebarUiStateOwner.ts
// Purpose: Own persisted sidebar paging, disclosure, dismissed-status, and route state.
// Layer: Web sidebar controller

import { ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useState } from "react";
import type { LastThreadRoute } from "../chatRouteRestore";
import {
  normalizeSidebarProjectThreadListCwd,
  persistSidebarUiState,
  readSidebarUiState,
} from "../components/Sidebar.uiState";
import { resolveThreadStatusPill } from "../components/Sidebar.statusLogic";
import { pruneProjectThreadListPagingForCollapsedProjects } from "../components/Sidebar.treeLogic";
import type { Project, SidebarThreadSummary } from "../types";

interface UseSidebarUiStateOwnerInput {
  readonly standardProjects: readonly Project[];
  readonly sidebarThreads: readonly SidebarThreadSummary[];
  readonly sidebarThreadSummaryById: Readonly<Record<string, SidebarThreadSummary>>;
  readonly routeThreadId: ThreadId | null;
  readonly routeSplitViewId: string | null;
  readonly isOnSettings: boolean;
  readonly isOnWorkspace: boolean;
  readonly markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
}

export function useSidebarUiStateOwner({
  standardProjects,
  sidebarThreads,
  sidebarThreadSummaryById,
  routeThreadId,
  routeSplitViewId,
  isOnSettings,
  isOnWorkspace,
  markThreadVisited,
}: UseSidebarUiStateOwnerInput) {
  const [threadListExtraPagesByProjectCwd, setThreadListExtraPagesByProjectCwd] = useState<
    ReadonlyMap<string, number>
  >(() => new Map(Object.entries(readSidebarUiState().projectThreadListExtraPagesByCwd)));
  const [chatSectionExpanded, setChatSectionExpanded] = useState(
    () => readSidebarUiState().chatSectionExpanded,
  );
  const [chatThreadListExtraPages, setChatThreadListExtraPages] = useState(
    () => readSidebarUiState().chatThreadListExtraPages,
  );
  const [dismissedThreadStatusKeyByThreadId, setDismissedThreadStatusKeyByThreadId] = useState<
    Record<string, string>
  >(() => readSidebarUiState().dismissedThreadStatusKeyByThreadId);
  const [lastThreadRoute, setLastThreadRoute] = useState(
    () => readSidebarUiState().lastThreadRoute,
  );

  const dismissThreadStatus = useCallback(
    (threadId: ThreadId, statusKey: string | null | undefined) => {
      if (!statusKey) return;
      setDismissedThreadStatusKeyByThreadId((current) => {
        if (current[threadId] === statusKey) return current;
        return { ...current, [threadId]: statusKey };
      });
    },
    [],
  );
  const clearDismissedThreadStatus = useCallback((threadId: ThreadId) => {
    setDismissedThreadStatusKeyByThreadId((current) => {
      if (!(threadId in current)) return current;
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }, []);
  const resolveThreadStatusForSidebar = useCallback(
    (thread: SidebarThreadSummary) =>
      resolveThreadStatusPill({
        thread: {
          ...thread,
          dismissedStatusKey: dismissedThreadStatusKeyByThreadId[thread.id],
        },
        hasPendingApprovals: thread.hasPendingApprovals,
        hasPendingUserInput: thread.hasPendingUserInput,
      }),
    [dismissedThreadStatusKeyByThreadId],
  );
  const clearThreadNotification = useCallback(
    (threadId: ThreadId) => {
      const thread = sidebarThreadSummaryById[threadId];
      if (!thread) return;
      const status = resolveThreadStatusForSidebar(thread);
      if (!status?.dismissible) return;
      if (status.label === "Completed") {
        markThreadVisited(threadId, thread.latestTurn?.completedAt ?? undefined);
        return;
      }
      dismissThreadStatus(threadId, status.dismissalKey);
    },
    [
      dismissThreadStatus,
      markThreadVisited,
      resolveThreadStatusForSidebar,
      sidebarThreadSummaryById,
    ],
  );

  const rememberLastThreadRouteNow = useCallback(
    (nextLastThreadRoute: LastThreadRoute) => {
      setLastThreadRoute(nextLastThreadRoute);
      persistSidebarUiState({
        chatSectionExpanded,
        chatThreadListExtraPages,
        projectThreadListExtraPagesByCwd: Object.fromEntries(threadListExtraPagesByProjectCwd),
        dismissedThreadStatusKeyByThreadId,
        lastThreadRoute: nextLastThreadRoute,
      });
    },
    [
      chatSectionExpanded,
      chatThreadListExtraPages,
      dismissedThreadStatusKeyByThreadId,
      threadListExtraPagesByProjectCwd,
    ],
  );

  const setThreadListExtraPagesForProject = useCallback(
    (projectCwd: string, nextExtraPages: number) => {
      const cwdKey = normalizeSidebarProjectThreadListCwd(projectCwd);
      if (cwdKey.length === 0) return;
      setThreadListExtraPagesByProjectCwd((current) => {
        const clampedExtraPages = Math.max(0, nextExtraPages);
        if ((current.get(cwdKey) ?? 0) === clampedExtraPages) return current;
        const next = new Map(current);
        if (clampedExtraPages === 0) next.delete(cwdKey);
        else next.set(cwdKey, clampedExtraPages);
        return next;
      });
    },
    [],
  );
  const showMoreThreadsForProject = useCallback(
    (projectCwd: string, currentExtraPages: number) => {
      setThreadListExtraPagesForProject(projectCwd, currentExtraPages + 1);
    },
    [setThreadListExtraPagesForProject],
  );
  const showLessThreadsForProject = useCallback(
    (projectCwd: string, currentExtraPages: number) => {
      setThreadListExtraPagesForProject(projectCwd, currentExtraPages - 1);
    },
    [setThreadListExtraPagesForProject],
  );
  const toggleChatSection = useCallback(() => setChatSectionExpanded((current) => !current), []);
  const showMoreChatThreads = useCallback(
    (currentExtraPages: number) => setChatThreadListExtraPages(currentExtraPages + 1),
    [],
  );
  const showLessChatThreads = useCallback(
    (currentExtraPages: number) => setChatThreadListExtraPages(Math.max(0, currentExtraPages - 1)),
    [],
  );

  useEffect(() => {
    setThreadListExtraPagesByProjectCwd((current) =>
      pruneProjectThreadListPagingForCollapsedProjects({
        threadListExtraPagesByProjectCwd: current,
        projects: standardProjects,
        normalizeProjectCwd: normalizeSidebarProjectThreadListCwd,
      }),
    );
  }, [standardProjects]);
  useEffect(() => {
    const retainedThreadIds = new Set(sidebarThreads.map((thread) => thread.id));
    setDismissedThreadStatusKeyByThreadId((current) => {
      const nextEntries = Object.entries(current).filter(([threadId]) =>
        retainedThreadIds.has(ThreadId.makeUnsafe(threadId)),
      );
      return nextEntries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(nextEntries);
    });
  }, [sidebarThreads]);
  useEffect(() => {
    persistSidebarUiState({
      chatSectionExpanded,
      chatThreadListExtraPages,
      projectThreadListExtraPagesByCwd: Object.fromEntries(threadListExtraPagesByProjectCwd),
      dismissedThreadStatusKeyByThreadId,
      lastThreadRoute,
    });
  }, [
    chatSectionExpanded,
    chatThreadListExtraPages,
    dismissedThreadStatusKeyByThreadId,
    lastThreadRoute,
    threadListExtraPagesByProjectCwd,
  ]);
  useEffect(() => {
    if (isOnWorkspace || isOnSettings || routeThreadId === null) return;
    const nextLastThreadRoute = {
      threadId: routeThreadId,
      ...(routeSplitViewId ? { splitViewId: routeSplitViewId } : {}),
    };
    setLastThreadRoute((current) =>
      current?.threadId === nextLastThreadRoute.threadId &&
      current?.splitViewId === nextLastThreadRoute.splitViewId
        ? current
        : nextLastThreadRoute,
    );
  }, [isOnSettings, isOnWorkspace, routeSplitViewId, routeThreadId]);

  return {
    chatSectionExpanded,
    chatThreadListExtraPages,
    threadListExtraPagesByProjectCwd,
    lastThreadRoute,
    clearDismissedThreadStatus,
    clearThreadNotification,
    rememberLastThreadRouteNow,
    resolveThreadStatusForSidebar,
    showMoreThreadsForProject,
    showLessThreadsForProject,
    toggleChatSection,
    showMoreChatThreads,
    showLessChatThreads,
  };
}
