// FILE: useSidebarDerivedReadModel.ts
// Purpose: Derives the sidebar's project, thread-tree, paging, and rendered-visibility read model.
// Layer: Web sidebar view-model

import { useMemo } from "react";
import type { ProjectId, ThreadId } from "@agent-group/contracts";
import type { SidebarThreadSortOrder } from "../appSettings";
import type { Project, SidebarThreadSummary } from "../types";
import { isHomeChatContainerProject } from "../lib/chatProjects";
import { isStudioContainerProject } from "../lib/studioProjects";
import {
  buildProjectThreadTree,
  deriveSidebarProjectData,
  getPinnedThreadsForSidebar,
  getUnpinnedThreadsForSidebar,
  getVisibleSidebarEntriesForPreview,
  groupSidebarThreadsByProjectId,
  resolveProjectEmptyState,
  resolveSidebarThreadListPaging,
  sortThreadsForSidebar,
  type SidebarDerivedProjectData,
  type ThreadStatusPill,
} from "../components/Sidebar.logic";
import { normalizeSidebarProjectThreadListCwd } from "../components/Sidebar.uiState";

const THREAD_PREVIEW_LIMIT = 5;
const THREAD_PREVIEW_PAGE_SIZE = 5;
const EMPTY_PROJECT_SIDEBAR_DATA: ReadonlyMap<ProjectId, SidebarDerivedProjectData> = new Map();

export type SidebarDerivedReadModelInput = {
  projects: {
    sorted: readonly Project[];
    standard: readonly Project[];
  };
  threads: {
    display: readonly SidebarThreadSummary[];
    partitions: {
      nonStudio: readonly SidebarThreadSummary[];
      studio: readonly SidebarThreadSummary[];
      nonStudioDisplay: readonly SidebarThreadSummary[];
      studioDisplay: readonly SidebarThreadSummary[];
    };
    pinnedIds: readonly ThreadId[];
    expandedSubagentParentIds: ReadonlySet<ThreadId>;
    activeId: ThreadId | null | undefined;
    sortOrder: SidebarThreadSortOrder;
    resolveStatus: (thread: SidebarThreadSummary) => ThreadStatusPill;
  };
  workspace: {
    homeDir: string | null;
    chatRoot: string | null;
    studioRoot: string | null;
  };
  surface: {
    isStudio: boolean;
    chatSectionExpanded: boolean;
  };
  paging: {
    chatExtraPages: number;
    projectExtraPagesByCwd: ReadonlyMap<string, number>;
  };
  emptyState: {
    threadsHydrated: boolean;
    shouldShowProjectPathEntry: boolean;
  };
};

export function useSidebarDerivedReadModel(input: SidebarDerivedReadModelInput) {
  const { projects, threads, workspace, surface, paging, emptyState } = input;

  const pinned = useMemo(
    () =>
      getPinnedThreadsForSidebar(
        surface.isStudio ? threads.partitions.studioDisplay : threads.partitions.nonStudioDisplay,
        threads.pinnedIds,
      ),
    [
      surface.isStudio,
      threads.partitions.nonStudioDisplay,
      threads.partitions.studioDisplay,
      threads.pinnedIds,
    ],
  );

  const groupedByProjectId = useMemo(
    () => groupSidebarThreadsByProjectId(threads.display),
    [threads.display],
  );
  const sortedByProjectId = useMemo(() => {
    const byProjectId = new Map<ProjectId, SidebarThreadSummary[]>();
    for (const [projectId, projectThreads] of groupedByProjectId) {
      byProjectId.set(projectId, sortThreadsForSidebar(projectThreads, threads.sortOrder));
    }
    return byProjectId;
  }, [groupedByProjectId, threads.sortOrder]);

  const chatProjects = useMemo(
    () =>
      projects.sorted.filter((project) =>
        isHomeChatContainerProject(project, {
          homeDir: workspace.homeDir,
          chatWorkspaceRoot: workspace.chatRoot,
        }),
      ),
    [projects.sorted, workspace.chatRoot, workspace.homeDir],
  );
  const studioProjects = useMemo(
    () =>
      projects.sorted.filter((project) =>
        isStudioContainerProject(project, {
          homeDir: workspace.homeDir,
          chatWorkspaceRoot: workspace.chatRoot,
          studioWorkspaceRoot: workspace.studioRoot,
        }),
      ),
    [projects.sorted, workspace.chatRoot, workspace.homeDir, workspace.studioRoot],
  );

  const chatRows = useMemo(() => {
    if (!surface.chatSectionExpanded) {
      return [];
    }
    return buildProjectThreadTree({
      threads: sortThreadsForSidebar(
        chatProjects.flatMap((project) => sortedByProjectId.get(project.id) ?? []),
        threads.sortOrder,
      ),
      expandedParentThreadIds: threads.expandedSubagentParentIds,
    });
  }, [
    chatProjects,
    sortedByProjectId,
    surface.chatSectionExpanded,
    threads.expandedSubagentParentIds,
    threads.sortOrder,
  ]);
  const chatIds = useMemo(() => chatRows.map((row) => row.thread.id), [chatRows]);

  const studioRows = useMemo(() => {
    if (!surface.isStudio) {
      return [];
    }
    return buildProjectThreadTree({
      threads: sortThreadsForSidebar(
        getUnpinnedThreadsForSidebar(
          studioProjects.flatMap((project) => sortedByProjectId.get(project.id) ?? []),
          threads.pinnedIds,
        ),
        threads.sortOrder,
      ),
      expandedParentThreadIds: threads.expandedSubagentParentIds,
    });
  }, [
    sortedByProjectId,
    studioProjects,
    surface.isStudio,
    threads.expandedSubagentParentIds,
    threads.pinnedIds,
    threads.sortOrder,
  ]);
  const studioIds = useMemo(() => studioRows.map((row) => row.thread.id), [studioRows]);

  const chatPreviewEntries = useMemo(
    () =>
      chatRows.map((row) => ({
        rowId: row.thread.id,
        rootRowId: row.rootThreadId,
        row,
      })),
    [chatRows],
  );
  const activeChatPreviewEntry =
    threads.activeId === undefined
      ? null
      : (chatPreviewEntries.find((entry) => entry.rowId === threads.activeId) ?? null);
  const chatPaging = useMemo(() => {
    const resolved = resolveSidebarThreadListPaging({
      totalCount: chatPreviewEntries.length,
      baseLimit: THREAD_PREVIEW_LIMIT,
      pageSize: THREAD_PREVIEW_PAGE_SIZE,
      requestedExtraPages: paging.chatExtraPages,
    });
    const { visibleEntries } = getVisibleSidebarEntriesForPreview({
      entries: chatPreviewEntries,
      activeEntryId: activeChatPreviewEntry?.rowId,
      previewLimit: resolved.previewLimit,
    });
    return {
      canShowMore: resolved.canShowMore && visibleEntries.length < chatPreviewEntries.length,
      canShowLess: resolved.canShowLess,
      effectiveExtraPages: resolved.effectiveExtraPages,
      renderedEntries: visibleEntries,
    };
  }, [activeChatPreviewEntry?.rowId, chatPreviewEntries, paging.chatExtraPages]);

  const projectEmptyState = resolveProjectEmptyState({
    projectCount: projects.standard.length,
    shouldShowProjectPathEntry: emptyState.shouldShowProjectPathEntry,
    threadsHydrated: emptyState.threadsHydrated,
  });
  const standardProjectDataById = useMemo<ReadonlyMap<ProjectId, SidebarDerivedProjectData>>(
    () =>
      deriveSidebarProjectData({
        projects: projects.standard,
        sortedSidebarThreadsByProjectId: sortedByProjectId,
        pinnedThreadIds: threads.pinnedIds,
        expandedParentThreadIds: threads.expandedSubagentParentIds,
        threadListExtraPagesByProjectCwd: paging.projectExtraPagesByCwd,
        normalizeProjectCwd: normalizeSidebarProjectThreadListCwd,
        activeSidebarThreadId: threads.activeId ?? undefined,
        previewLimit: THREAD_PREVIEW_LIMIT,
        previewPageSize: THREAD_PREVIEW_PAGE_SIZE,
        resolveThreadStatus: threads.resolveStatus,
      }),
    [
      paging.projectExtraPagesByCwd,
      projects.standard,
      sortedByProjectId,
      threads.activeId,
      threads.expandedSubagentParentIds,
      threads.pinnedIds,
      threads.resolveStatus,
    ],
  );
  const studioProjectDataById = useMemo<ReadonlyMap<ProjectId, SidebarDerivedProjectData>>(() => {
    if (!surface.isStudio) {
      return EMPTY_PROJECT_SIDEBAR_DATA;
    }
    return deriveSidebarProjectData({
      projects: studioProjects,
      sortedSidebarThreadsByProjectId: sortedByProjectId,
      pinnedThreadIds: threads.pinnedIds,
      expandedParentThreadIds: threads.expandedSubagentParentIds,
      threadListExtraPagesByProjectCwd: paging.projectExtraPagesByCwd,
      normalizeProjectCwd: normalizeSidebarProjectThreadListCwd,
      activeSidebarThreadId: threads.activeId ?? undefined,
      previewLimit: THREAD_PREVIEW_LIMIT,
      previewPageSize: THREAD_PREVIEW_PAGE_SIZE,
      resolveThreadStatus: threads.resolveStatus,
    });
  }, [
    paging.projectExtraPagesByCwd,
    sortedByProjectId,
    studioProjects,
    surface.isStudio,
    threads.activeId,
    threads.expandedSubagentParentIds,
    threads.pinnedIds,
    threads.resolveStatus,
  ]);

  const surfaceProjects = surface.isStudio ? studioProjects : projects.standard;
  const surfaceProjectDataById = surface.isStudio ? studioProjectDataById : standardProjectDataById;
  const allStandardProjectsExpanded = useMemo(
    () => projects.standard.length > 0 && projects.standard.every((project) => project.expanded),
    [projects.standard],
  );

  const visibleSidebarThreadIds = useMemo(() => {
    const visibleThreadIdSet = new Set<ThreadId>();
    for (const thread of pinned) {
      visibleThreadIdSet.add(thread.id);
    }
    for (const project of surfaceProjects) {
      const projectData = surfaceProjectDataById.get(project.id);
      if (!projectData) continue;
      if (!project.expanded) {
        if (projectData.activeEntryId) visibleThreadIdSet.add(projectData.activeEntryId);
        continue;
      }
      for (const entry of projectData.visibleEntries) {
        visibleThreadIdSet.add(entry.rowId);
      }
    }
    for (const threadId of studioIds) {
      visibleThreadIdSet.add(threadId);
    }
    return [...visibleThreadIdSet];
  }, [pinned, studioIds, surfaceProjectDataById, surfaceProjects]);
  const visibleSidebarThreadIdSet = useMemo(
    () => new Set([...visibleSidebarThreadIds, ...chatIds, ...studioIds]),
    [chatIds, studioIds, visibleSidebarThreadIds],
  );
  const visibleSidebarThreads = useMemo(
    () => threads.display.filter((thread) => visibleSidebarThreadIdSet.has(thread.id)),
    [threads.display, visibleSidebarThreadIdSet],
  );

  return {
    projects: {
      chat: chatProjects,
      studio: studioProjects,
      surface: surfaceProjects,
      standardDataById: standardProjectDataById,
      studioDataById: studioProjectDataById,
      surfaceDataById: surfaceProjectDataById,
      emptyState: projectEmptyState,
      allStandardExpanded: allStandardProjectsExpanded,
    },
    threads: {
      partitions: threads.partitions,
      groupedByProjectId,
      sortedByProjectId,
      pinned,
      chatRows,
      chatIds,
      studioRows,
      studioIds,
      visibleIds: visibleSidebarThreadIds,
      visibleIdSet: visibleSidebarThreadIdSet,
      visible: visibleSidebarThreads,
    },
    paging: {
      chat: chatPaging,
    },
  };
}

export type SidebarDerivedReadModel = ReturnType<typeof useSidebarDerivedReadModel>;
