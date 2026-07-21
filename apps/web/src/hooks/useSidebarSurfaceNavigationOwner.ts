// FILE: useSidebarSurfaceNavigationOwner.ts
// Purpose: Own sidebar segment routing, route restoration, and container-chat prewarming.
// Layer: Web sidebar controller

import { ThreadId, type ProjectId } from "@agent-group/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { startTransition, useCallback, useEffect, useMemo, useRef } from "react";
import { useAppSettings } from "../appSettings";
import type { LastThreadRoute } from "../chatRouteRestore";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  resolveSettingsBackTarget,
  sortThreadsForSidebar,
  type SettingsBackTarget,
  type SidebarView,
} from "../components/Sidebar.logic";
import { useHandleNewChat } from "./useHandleNewChat";
import { useHandleNewStudioChat } from "./useHandleNewStudioChat";
import { useThreadDetailPrewarm } from "../threadDetailPrewarm";
import { useSplitViewStore } from "../splitViewStore";
import { isStudioContainerProject, prewarmStudioProject } from "../lib/studioProjects";
import { prewarmHomeChatProject } from "../lib/chatProjects";
import type { Project, SidebarThreadSummary } from "../types";
import { useWorkspaceStore } from "../workspaceStore";

interface UseSidebarSurfaceNavigationOwnerInput {
  readonly projects: readonly Project[];
  readonly sidebarThreadSummaryById: Readonly<Record<string, SidebarThreadSummary>>;
  readonly studioProjectIdSet: ReadonlySet<ProjectId>;
  readonly studioThreads: readonly SidebarThreadSummary[];
  readonly nonStudioThreads: readonly SidebarThreadSummary[];
  readonly lastThreadRoute: LastThreadRoute | null;
  readonly threadsHydrated: boolean;
  readonly isOnSettings: boolean;
  readonly isOnWorkspace: boolean;
  readonly isOnStudioRoute: boolean;
  readonly studioSectionVisible: boolean;
  readonly workspaceSectionVisible: boolean;
  readonly navigateToWorkspace: (workspaceId: string, options?: { replace?: boolean }) => void;
}

export function useSidebarSurfaceNavigationOwner({
  projects,
  sidebarThreadSummaryById,
  studioProjectIdSet,
  studioThreads,
  nonStudioThreads,
  lastThreadRoute,
  threadsHydrated,
  isOnSettings,
  isOnWorkspace,
  isOnStudioRoute,
  studioSectionVisible,
  workspaceSectionVisible,
  navigateToWorkspace,
}: UseSidebarSurfaceNavigationOwnerInput) {
  const { settings } = useAppSettings();
  const navigate = useNavigate();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const routeWorkspaceId = useParams({
    strict: false,
    select: (params) => (typeof params.workspaceId === "string" ? params.workspaceId : null),
  });
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const splitViewsById = useSplitViewStore((store) => store.splitViewsById);
  const workspacePages = useWorkspaceStore((store) => store.workspacePages);
  const homeDir = useWorkspaceStore((store) => store.homeDir);
  const chatWorkspaceRoot = useWorkspaceStore((store) => store.chatWorkspaceRoot);
  const studioWorkspaceRoot = useWorkspaceStore((store) => store.studioWorkspaceRoot);
  const { handleNewChat } = useHandleNewChat();
  const { handleNewStudioChat } = useHandleNewStudioChat();
  const { prewarmThreadDetail } = useThreadDetailPrewarm();

  const activeRouteProjectId = routeThreadId
    ? (sidebarThreadSummaryById[routeThreadId]?.projectId ??
      draftThreadsByThreadId[routeThreadId]?.projectId ??
      null)
    : null;
  const activeRouteProject = activeRouteProjectId
    ? (projects.find((project) => project.id === activeRouteProjectId) ?? null)
    : null;
  const isOnStudio =
    isOnStudioRoute ||
    isStudioContainerProject(activeRouteProject, {
      homeDir,
      chatWorkspaceRoot,
      studioWorkspaceRoot,
    });

  const resolveBackTargetForThreads = useCallback(
    (threads: readonly SidebarThreadSummary[], extraThreadIds: ReadonlySet<string>) => {
      const latestThread =
        sortThreadsForSidebar(threads, settings.sidebarThreadSortOrder)[0] ?? null;
      const availableThreadIds = new Set<string>(threads.map((thread) => thread.id));
      for (const threadId of extraThreadIds) availableThreadIds.add(threadId);
      return resolveSettingsBackTarget({
        lastThreadRoute,
        availableThreadIds,
        availableSplitViewIds: new Set(
          Object.keys(splitViewsById).filter((splitViewId) => splitViewsById[splitViewId]),
        ),
        latestThreadId: latestThread?.id ?? null,
      });
    },
    [lastThreadRoute, settings.sidebarThreadSortOrder, splitViewsById],
  );
  const { studioDraftThreadIds, nonStudioDraftThreadIds } = useMemo(() => {
    const studioIds = new Set<string>();
    const nonStudioIds = new Set<string>();
    for (const [threadId, draft] of Object.entries(draftThreadsByThreadId)) {
      (studioProjectIdSet.has(draft.projectId) ? studioIds : nonStudioIds).add(threadId);
    }
    return { studioDraftThreadIds: studioIds, nonStudioDraftThreadIds: nonStudioIds };
  }, [draftThreadsByThreadId, studioProjectIdSet]);
  const activeStudioThreads = useMemo(
    () => studioThreads.filter((thread) => (thread.archivedAt ?? null) === null),
    [studioThreads],
  );
  const resolveBackToStudioTarget = useCallback(
    () => resolveBackTargetForThreads(activeStudioThreads, studioDraftThreadIds),
    [activeStudioThreads, resolveBackTargetForThreads, studioDraftThreadIds],
  );
  const resolveBackToThreadsTarget = useCallback(
    () => resolveBackTargetForThreads(nonStudioThreads, nonStudioDraftThreadIds),
    [nonStudioDraftThreadIds, nonStudioThreads, resolveBackTargetForThreads],
  );
  const navigateToBackTarget = useCallback(
    (target: SettingsBackTarget) => {
      if (target.kind !== "thread") return false;
      startTransition(() => {
        void navigate({
          to: "/$threadId",
          params: { threadId: ThreadId.makeUnsafe(target.threadId) },
          search: () => ({ splitViewId: target.splitViewId }),
        });
      });
      return true;
    },
    [navigate],
  );
  const openStudioChatFallback = useCallback(() => {
    void handleNewStudioChat().then((result) => {
      if (!result.ok) void navigate({ to: "/studio" });
    });
  }, [handleNewStudioChat, navigate]);

  const lastActiveSegmentRef = useRef<"studio" | "threads">("threads");
  useEffect(() => {
    if (!isOnSettings) lastActiveSegmentRef.current = isOnStudio ? "studio" : "threads";
  }, [isOnSettings, isOnStudio]);

  const backFromSettings = useCallback(() => {
    const fromStudio = lastActiveSegmentRef.current === "studio";
    const target = fromStudio ? resolveBackToStudioTarget() : resolveBackToThreadsTarget();
    if (navigateToBackTarget(target)) return;
    if (fromStudio) {
      openStudioChatFallback();
      return;
    }
    void navigate({ to: "/" });
  }, [
    navigate,
    navigateToBackTarget,
    openStudioChatFallback,
    resolveBackToStudioTarget,
    resolveBackToThreadsTarget,
  ]);

  const selectView = useCallback(
    (view: SidebarView) => {
      if (view === "workspace") {
        const workspaceId = routeWorkspaceId ?? workspacePages[0]?.id;
        if (workspaceId) navigateToWorkspace(workspaceId);
        return;
      }
      if (view === "studio") {
        if (!navigateToBackTarget(resolveBackToStudioTarget())) openStudioChatFallback();
        return;
      }
      if (!navigateToBackTarget(resolveBackToThreadsTarget())) {
        void handleNewChat({ fresh: true });
      }
    },
    [
      handleNewChat,
      navigateToBackTarget,
      navigateToWorkspace,
      openStudioChatFallback,
      resolveBackToStudioTarget,
      resolveBackToThreadsTarget,
      routeWorkspaceId,
      workspacePages,
    ],
  );

  useEffect(() => {
    if (isOnSettings) return;
    if ((isOnStudio && !studioSectionVisible) || (isOnWorkspace && !workspaceSectionVisible)) {
      selectView("threads");
    }
  }, [
    isOnSettings,
    isOnStudio,
    isOnWorkspace,
    selectView,
    studioSectionVisible,
    workspaceSectionVisible,
  ]);
  useEffect(() => {
    if (threadsHydrated && homeDir) prewarmHomeChatProject({ homeDir, chatWorkspaceRoot });
  }, [chatWorkspaceRoot, homeDir, threadsHydrated]);
  useEffect(() => {
    if (threadsHydrated && studioSectionVisible && studioWorkspaceRoot) {
      prewarmStudioProject({ homeDir, chatWorkspaceRoot, studioWorkspaceRoot });
    }
  }, [chatWorkspaceRoot, homeDir, studioSectionVisible, studioWorkspaceRoot, threadsHydrated]);

  const createHomeChat = useCallback(async () => {
    await handleNewChat({ fresh: true });
  }, [handleNewChat]);
  const createStudioChat = useCallback(async () => {
    await handleNewStudioChat({ fresh: true });
  }, [handleNewStudioChat]);
  const prewarmView = useCallback(
    (view: SidebarView) => {
      if (view !== "studio" && view !== "threads") return;
      const target = view === "studio" ? resolveBackToStudioTarget() : resolveBackToThreadsTarget();
      if (target.kind === "thread") prewarmThreadDetail(ThreadId.makeUnsafe(target.threadId));
    },
    [prewarmThreadDetail, resolveBackToStudioTarget, resolveBackToThreadsTarget],
  );

  return {
    isOnStudio,
    backFromSettings,
    selectView,
    prewarmView,
    createHomeChat,
    createStudioChat,
  };
}
