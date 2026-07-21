// FILE: useSidebarController.ts
// Purpose: Owns the project/thread sidebar read models and actions.
// Exports: sidebar controller hook and inferred contract

import type { ResolvedKeybindingsConfig } from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { useAppSettings } from "../../appSettings";
import { useStore } from "../../store";
import { serverConfigQueryOptions } from "../../lib/serverReactQuery";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useSidebarAttentionOwner } from "../../hooks/useSidebarAttentionOwner";
import { useSidebarDebugFeatureFlagsOwner } from "../../hooks/useSidebarDebugFeatureFlagsOwner";
import { useSidebarDesktopUpdateOwner } from "../../hooks/useSidebarDesktopUpdateOwner";
import { useSidebarDerivedReadModel } from "../../hooks/useSidebarDerivedReadModel";
import { useSidebarKeyboardOwner } from "../../hooks/useSidebarKeyboardOwner";
import { useSidebarLifecycleOwner } from "../../hooks/useSidebarLifecycleOwner";
import { useSidebarMultiSelectOwner } from "../../hooks/useSidebarMultiSelectOwner";
import { useSidebarNavigationOwner } from "../../hooks/useSidebarNavigationOwner";
import { useSidebarPinningOwner } from "../../hooks/useSidebarPinningOwner";
import { useSidebarProjectRunOwner } from "../../hooks/useSidebarProjectRunOwner";
import { useSidebarRouteReadModel } from "../../hooks/useSidebarRouteReadModel";
import { useSidebarStoreReadModel } from "../../hooks/useSidebarStoreReadModel";
import { useSidebarThreadArchiveOwner } from "../../hooks/useSidebarThreadArchiveOwner";
import { useSidebarThreadContextMenuOwner } from "../../hooks/useSidebarThreadContextMenuOwner";
import { useSidebarThreadDeleteOwner } from "../../hooks/useSidebarThreadDeleteOwner";
import { useSidebarUiStateOwner } from "../../hooks/useSidebarUiStateOwner";
import { useSidebarVisibleThreadPrs } from "../../hooks/useSidebarVisibleThreadPrs";
import { useSidebarWorkspaceOwner } from "../../hooks/useSidebarWorkspaceOwner";
import { useSidebarProjectAccessOwner } from "../../hooks/useSidebarProjectAccessOwner";
import { useSidebarProjectMenuOwner } from "../../hooks/useSidebarProjectMenuOwner";
import { useSidebarProjectListOwner } from "../../hooks/useSidebarProjectListOwner";
import { useSidebarSurfaceNavigationOwner } from "../../hooks/useSidebarSurfaceNavigationOwner";
import { useSidebarThreadInteractionOwner } from "../../hooks/useSidebarThreadInteractionOwner";
import { useSidebarThreadImportOwner } from "../../hooks/useSidebarThreadImportOwner";
import { useTerminalStateStore } from "../../terminalStateStore";
import { useSplitViewStore } from "../../splitViewStore";
import type { SidebarThreadRowsOwner } from "./SidebarThreadRowShared";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

export function useSidebarController() {
  const { showDebugFeatureFlagsMenu } = useSidebarDebugFeatureFlagsOwner();
  const { settings: appSettings, updateSettings } = useAppSettings();
  const routeReadModel = useSidebarRouteReadModel();
  const { route, surface, settings: routeSettings } = routeReadModel;
  const routeThreadId = route.threadId;
  const routeWorkspaceId = route.workspaceId;
  const routeSearch = route.search;
  const activeSplitView = route.activeSplitView;
  const splitViewsById = route.splitViewsById;
  const {
    isOnSettings,
    isOnWorkspace,
    isOnStudioRoute,
    isOnKanban,
    isOnAutomations,
    isOnPullRequests,
  } = surface;
  const activeSettingsSection = routeSettings.activeSection;
  const storeReadModel = useSidebarStoreReadModel({
    route: { threadId: routeThreadId },
    settings: { projectSortOrder: appSettings.sidebarProjectSortOrder },
  });
  const {
    projects,
    threadsHydrated,
    sidebarThreadSummaryById,
    terminalStateByThreadId,
    draftThreadsByThreadId,
    temporaryThreadIds,
  } = storeReadModel.store;
  const { homeDir, chatWorkspaceRoot, studioWorkspaceRoot, focusedProjectId } =
    storeReadModel.workspace;
  const {
    sorted: sortedProjects,
    standardBase: standardProjectsBase,
    studioIds: studioProjectIdSet,
    byId: projectById,
    cwdById: projectCwdById,
  } = storeReadModel.projects;
  const {
    all: sidebarThreads,
    display: sidebarDisplayThreads,
    nonStudio: nonStudioSidebarThreads,
    studio: studioSidebarThreads,
    nonStudioDisplay: nonStudioSidebarDisplayThreads,
    studioDisplay: studioSidebarDisplayThreads,
  } = storeReadModel.threads;
  const terminalOpen = storeReadModel.terminal.open;
  const terminalWorkspaceOpen = storeReadModel.terminal.workspaceOpen;
  const { automationAttentionBadge, automationsByThreadId, pullRequestsReviewBadge } =
    useSidebarAttentionOwner({ projects });
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const markThreadVisited = useStore((store) => store.markThreadVisited);
  const markThreadUnread = useStore((store) => store.markThreadUnread);
  const toggleProject = useStore((store) => store.toggleProject);
  const setAllProjectsExpanded = useStore((store) => store.setAllProjectsExpanded);
  const collapseProjectsExcept = useStore((store) => store.collapseProjectsExcept);
  const reorderProjects = useStore((store) => store.reorderProjects);
  const openChatThreadPage = useTerminalStateStore((state) => state.openChatThreadPage);
  const openTerminalThreadPage = useTerminalStateStore((state) => state.openTerminalThreadPage);
  const { navigate, navigateToWorkspace, openUsageSettings } = useSidebarNavigationOwner();
  const chatsSectionVisible = appSettings.showChatsSection;
  const studioSectionVisible = appSettings.showStudioSection;
  const workspaceSectionVisible = appSettings.showWorkspaceSection;
  const { handleNewThread } = useHandleNewThread();

  const createSplitViewFromDrop = useSplitViewStore((store) => store.createFromDrop);
  const setSplitFocusedPane = useSplitViewStore((store) => store.setFocusedPane);
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const desktopUpdate = useSidebarDesktopUpdateOwner();
  const {
    pinnedProjectIdSet,
    pinnedThreadIds,
    pinnedThreadIdSet,
    standardProjects,
    toggleProjectPinned,
    toggleThreadPinned,
  } = useSidebarPinningOwner({
    projects,
    sidebarDisplayThreads,
    sidebarThreadSummaryById,
    sidebarThreads,
    standardProjectsBase,
    threadsHydrated,
  });
  const {
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
  } = useSidebarUiStateOwner({
    standardProjects,
    sidebarThreads,
    sidebarThreadSummaryById,
    routeThreadId,
    routeSplitViewId: routeSearch.splitViewId ?? null,
    isOnSettings,
    isOnWorkspace,
    markThreadVisited,
  });
  const {
    dialog: projectRunDialog,
    runsByProjectId: projectRunsByProjectId,
    serverByProjectId: projectRunServerByProjectId,
    canOpenServer: canOpenProjectRunServer,
    setDialogCommandDraft: setProjectRunDialogCommandDraft,
    openDialog: openProjectRunDialog,
    closeDialog: closeProjectRunDialog,
    confirmDialog: handleConfirmProjectRun,
    stop: handleStopProjectRun,
    openServer: handleOpenProjectRunServer,
  } = useSidebarProjectRunOwner({ projects: standardProjects });
  const workspaceOwner = useSidebarWorkspaceOwner({ routeWorkspaceId, navigateToWorkspace });
  const surfaceNavigation = useSidebarSurfaceNavigationOwner({
    projects,
    sidebarThreadSummaryById,
    studioProjectIdSet,
    studioThreads: studioSidebarThreads,
    nonStudioThreads: nonStudioSidebarThreads,
    lastThreadRoute,
    threadsHydrated,
    isOnSettings,
    isOnWorkspace,
    isOnStudioRoute,
    studioSectionVisible,
    workspaceSectionVisible,
    navigateToWorkspace,
  });
  const { isOnStudio } = surfaceNavigation;
  const projectAccess = useSidebarProjectAccessOwner({
    projects,
    sidebarThreads,
    focusedProjectId,
    threadSortOrder: appSettings.sidebarThreadSortOrder,
    defaultEnvMode: appSettings.defaultThreadEnvMode,
    onNewThread: handleNewThread,
  });
  const targetImportProject = projectAccess.model.targetProjectId
    ? (projectById.get(projectAccess.model.targetProjectId) ?? null)
    : null;
  const { importThread: handleImportThread } = useSidebarThreadImportOwner({
    targetProject: targetImportProject,
    defaultEnvMode: appSettings.defaultThreadEnvMode,
  });
  const threadInteraction = useSidebarThreadInteractionOwner({
    routeThreadId,
    routeSplitViewId: routeSearch.splitViewId,
    activeSplitView,
    sidebarThreadSummaryById,
    splitViewsById,
    terminalStateByThreadId,
    openChatThreadPage,
    openTerminalThreadPage,
    openSidechatSplit: ({ sourceThreadId, ownerProjectId, sidechatThreadId }) =>
      createSplitViewFromDrop({
        sourceThreadId,
        ownerProjectId,
        droppedThreadId: sidechatThreadId,
        direction: "horizontal",
        side: "second",
      }),
    setSplitFocusedPane,
    rememberLastThreadRouteNow,
  });
  const activeSidebarThreadId = threadInteraction.model.activeThreadId;
  const visualActiveSidebarThreadId = threadInteraction.model.visualActiveThreadId;
  const selectedThreadIds = threadInteraction.model.selectedThreadIds;
  const expandedSubagentParentIds = threadInteraction.model.expandedSubagentParentIds;
  const clearSelection = threadInteraction.actions.clearSelection;
  const sidebarReadModel = useSidebarDerivedReadModel({
    projects: { sorted: sortedProjects, standard: standardProjects },
    threads: {
      display: sidebarDisplayThreads,
      partitions: {
        nonStudio: nonStudioSidebarThreads,
        studio: studioSidebarThreads,
        nonStudioDisplay: nonStudioSidebarDisplayThreads,
        studioDisplay: studioSidebarDisplayThreads,
      },
      pinnedIds: pinnedThreadIds,
      expandedSubagentParentIds,
      activeId: activeSidebarThreadId,
      sortOrder: appSettings.sidebarThreadSortOrder,
      resolveStatus: (thread) => resolveThreadStatusForSidebar(thread)!,
    },
    workspace: {
      homeDir,
      chatRoot: chatWorkspaceRoot,
      studioRoot: studioWorkspaceRoot,
    },
    surface: { isStudio: isOnStudio, chatSectionExpanded },
    paging: {
      chatExtraPages: chatThreadListExtraPages,
      projectExtraPagesByCwd: threadListExtraPagesByProjectCwd,
    },
    emptyState: {
      threadsHydrated,
      shouldShowProjectPathEntry: projectAccess.model.open,
    },
  });
  const pinnedThreads = sidebarReadModel.threads.pinned;
  const surfaceProjectSidebarDataById = sidebarReadModel.projects.surfaceDataById;
  const projectEmptyState = sidebarReadModel.projects.emptyState;
  const allProjectsExpanded = sidebarReadModel.projects.allStandardExpanded;
  const visibleChatThreadRows = sidebarReadModel.threads.chatRows;
  const visibleChatThreadIds = sidebarReadModel.threads.chatIds;
  const studioChatThreadRows = sidebarReadModel.threads.studioRows;
  const studioChatThreadIds = sidebarReadModel.threads.studioIds;
  const visibleSidebarThreadIds = sidebarReadModel.threads.visibleIds;
  const visibleSidebarThreads = sidebarReadModel.threads.visible;
  const {
    canShowMore: canShowMoreChatThreads,
    canShowLess: canShowLessChatThreads,
    effectiveExtraPages: chatThreadListEffectiveExtraPages,
    renderedEntries: renderedChatEntries,
  } = sidebarReadModel.paging.chat;
  const { prByThreadId, openPrLink } = useSidebarVisibleThreadPrs({
    threads: { visible: visibleSidebarThreads },
    projects: { cwdById: projectCwdById },
  });
  const { deleteThread, confirmAndDeleteThread, deleteProjectThreads, deleteAllThreadsInProject } =
    useSidebarThreadDeleteOwner({
      projects,
      sidebarThreads,
      sidebarThreadSummaryById,
      routeThreadId,
      routeSplitViewId: routeSearch.splitViewId ?? null,
      threadSortOrder: appSettings.sidebarThreadSortOrder,
      confirmThreadDelete: appSettings.confirmThreadDelete,
    });
  const {
    archiveThread,
    archiveThreadWithUndo,
    confirmAndArchiveThread,
    archiveAllThreadsInProject,
  } = useSidebarThreadArchiveOwner({
    projects,
    sidebarThreads,
    sidebarThreadSummaryById,
    routeThreadId,
    threadSortOrder: appSettings.sidebarThreadSortOrder,
    confirmThreadArchive: appSettings.confirmThreadArchive,
  });

  const { handleThreadContextMenu } = useSidebarThreadContextMenuOwner({
    sidebarThreadSummaryById,
    pinnedThreadIdSet,
    projectCwdById,
    resolveThreadStatus: resolveThreadStatusForSidebar,
    openRenameDialog: threadInteraction.actions.openRename,
    toggleThreadPinned,
    clearDismissedThreadStatus,
    clearThreadNotification,
    markThreadUnread,
    confirmAndArchiveThread,
    confirmAndDeleteThread,
  });
  const { handleMultiSelectContextMenu } = useSidebarMultiSelectOwner({
    confirmThreadArchive: appSettings.confirmThreadArchive,
    confirmThreadDelete: appSettings.confirmThreadDelete,
    clearDismissedThreadStatus,
    markThreadUnread,
    archiveThread,
    deleteThread,
  });
  const projectMenu = useSidebarProjectMenuOwner({
    projects,
    sidebarThreads,
    pinnedProjectIds: pinnedProjectIdSet,
    projectRunsByProjectId,
    canOpenServer: canOpenProjectRunServer,
    openRunDialog: openProjectRunDialog,
    stopRun: handleStopProjectRun,
    openServer: handleOpenProjectRunServer,
    togglePinned: toggleProjectPinned,
    archiveAllThreads: archiveAllThreadsInProject,
    deleteAllThreads: deleteAllThreadsInProject,
    deleteProjectThreads,
  });

  const projectList = useSidebarProjectListOwner({
    projects,
    sortOrder: appSettings.sidebarProjectSortOrder,
    selectedThreadCount: selectedThreadIds.size,
    focusedProjectId,
    allProjectsExpanded,
    reorderProjects,
    toggleProject,
    clearSelection,
    setAllProjectsExpanded,
    collapseProjectsExcept,
  });

  const {
    paletteOpen: searchPaletteOpen,
    paletteMode: searchPaletteMode,
    paletteInitialQuery: searchPaletteInitialQuery,
    paletteProjects: searchPaletteProjects,
    paletteActions: searchPaletteActions,
    setPaletteMode: setSearchPaletteMode,
    onPaletteOpenChange: handleSearchPaletteOpenChange,
    openSearch: openSearchPalette,
    visibleThreadJumpLabelByThreadId,
    visibleThreadJumpLabelPartsByThreadId,
    newThreadShortcutLabel,
    newChatShortcutLabel,
    newTerminalThreadShortcutLabel,
    searchShortcutLabel,
  } = useSidebarKeyboardOwner({
    keybindings,
    projects,
    visibleThreadIds: visibleSidebarThreadIds,
    activeThreadId: activeSidebarThreadId,
    terminalOpen,
    terminalWorkspaceOpen,
    homeDir,
    activateThread: threadInteraction.actions.activate,
    openUsageSettings,
  });
  const threadRowsOwner: SidebarThreadRowsOwner = {
    state: {
      activeThreadId: visualActiveSidebarThreadId,
      selectedThreadIds,
      pinnedThreadIds: pinnedThreadIdSet,
      terminalByThreadId: terminalStateByThreadId,
    },
    metadata: {
      projectsById: projectById,
      automationsByThreadId,
      prByThreadId,
      jumpLabelByThreadId: visibleThreadJumpLabelByThreadId,
      jumpLabelPartsByThreadId: visibleThreadJumpLabelPartsByThreadId,
      resolveStatus: resolveThreadStatusForSidebar,
      isTemporary: (threadId) =>
        temporaryThreadIds[threadId] === true ||
        draftThreadsByThreadId[threadId]?.isTemporary === true,
    },
    actions: {
      interaction: threadInteraction.actions,
      archiveWithUndo: archiveThreadWithUndo,
      togglePinned: toggleThreadPinned,
      openPr: openPrLink,
      openContextMenu: handleThreadContextMenu,
      openMultiSelectContextMenu: handleMultiSelectContextMenu,
    },
  };

  useSidebarLifecycleOwner({
    projects: { count: projects.length },
    threads: {
      hydrated: threadsHydrated,
      visibleIds: visibleSidebarThreadIds,
      activeId: activeSidebarThreadId,
    },
    syncServerShellSnapshot,
  });
  return {
    shell: { showDebugFeatureFlagsMenu, activeSettingsSection, isOnSettings, desktopUpdate },
    settings: { appSettings, updateSettings },
    surface: {
      isOnWorkspace,
      isOnStudio,
      isOnKanban,
      isOnAutomations,
      isOnPullRequests,
      chatsSectionVisible,
      studioSectionVisible,
      workspaceSectionVisible,
      automationAttentionBadge,
      pullRequestsReviewBadge,
      chatSectionExpanded,
    },
    owners: {
      workspaceOwner,
      surfaceNavigation,
      projectAccess,
      projectMenu,
      projectList,
      threadInteraction,
      threadRowsOwner,
    },
    data: {
      threadsHydrated,
      sidebarThreadSummaryById,
      homeDir,
      focusedProjectId,
      projectById,
      pinnedThreads,
      standardProjects,
      projectEmptyState,
      allProjectsExpanded,
      visibleChatThreadRows,
      visibleChatThreadIds,
      studioChatThreadRows,
      studioChatThreadIds,
      renderedChatEntries,
      surfaceProjectSidebarDataById,
      pinnedProjectIdSet,
      projectRunsByProjectId,
      projectRunServerByProjectId,
      canShowMoreChatThreads,
      canShowLessChatThreads,
      chatThreadListEffectiveExtraPages,
    },
    actions: {
      navigate,
      handleNewThread,
      handleImportThread,
      toggleProjectPinned,
      showMoreThreadsForProject,
      showLessThreadsForProject,
      toggleChatSection,
      showMoreChatThreads,
      showLessChatThreads,
    },
    keyboard: {
      searchPaletteOpen,
      searchPaletteMode,
      searchPaletteInitialQuery,
      searchPaletteProjects,
      searchPaletteActions,
      setSearchPaletteMode,
      handleSearchPaletteOpenChange,
      openSearchPalette,
      newThreadShortcutLabel,
      newChatShortcutLabel,
      newTerminalThreadShortcutLabel,
      searchShortcutLabel,
    },
    runDialog: {
      projectRunDialog,
      closeProjectRunDialog,
      setProjectRunDialogCommandDraft,
      handleConfirmProjectRun,
    },
  };
}

export type SidebarController = ReturnType<typeof useSidebarController>;
