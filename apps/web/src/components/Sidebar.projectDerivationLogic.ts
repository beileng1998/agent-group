// Per-project sidebar row derivation.

import type { ProjectId, ThreadId } from "@agent-group/contracts";
import type { Project, SidebarThreadSummary } from "../types";
import { getUnpinnedThreadsForSidebar } from "./Sidebar.pinningLogic";
import { resolveProjectStatusIndicator, resolveThreadStatusPill } from "./Sidebar.statusLogic";
import {
  buildProjectThreadTree,
  getVisibleSidebarEntriesForPreview,
  resolveSidebarThreadListPaging,
} from "./Sidebar.treeLogic";

export type SidebarProjectEntry = {
  kind: "thread";
  rowId: ThreadId;
  rootRowId: ThreadId;
  thread: SidebarThreadSummary;
  depth: number;
  childCount: number;
  isExpanded: boolean;
};

export type SidebarDerivedProjectData = {
  allProjectThreadCount: number;
  projectThreads: SidebarThreadSummary[];
  orderedProjectThreadIds: ThreadId[];
  visibleEntries: SidebarProjectEntry[];
  /** Extra "Show more" pages currently applied, clamped to the real row count. */
  threadListExtraPages: number;
  canShowMoreThreads: boolean;
  canShowLessThreads: boolean;
  activeEntryId: ThreadId | null;
  projectStatus: ReturnType<typeof resolveProjectStatusIndicator>;
};

// Groups thread summaries once so project-specific sidebar derivations can reuse the same slices.
export function groupSidebarThreadsByProjectId(
  threads: readonly SidebarThreadSummary[],
): ReadonlyMap<ProjectId, SidebarThreadSummary[]> {
  const byProjectId = new Map<ProjectId, SidebarThreadSummary[]>();
  for (const thread of threads) {
    const existing = byProjectId.get(thread.projectId);
    if (existing) {
      existing.push(thread);
    } else {
      byProjectId.set(thread.projectId, [thread]);
    }
  }
  return byProjectId;
}

export function partitionSidebarThreadsByProjectIds<
  T extends Pick<SidebarThreadSummary, "projectId">,
>(
  threads: readonly T[],
  studioProjectIds: ReadonlySet<ProjectId>,
): {
  readonly studioThreads: T[];
  readonly nonStudioThreads: T[];
} {
  const studioThreads: T[] = [];
  const nonStudioThreads: T[] = [];
  for (const thread of threads) {
    if (studioProjectIds.has(thread.projectId)) {
      studioThreads.push(thread);
    } else {
      nonStudioThreads.push(thread);
    }
  }
  return { studioThreads, nonStudioThreads };
}

// Centralizes the expensive per-project row derivation so Sidebar.tsx can mostly orchestrate UI state.
export function deriveSidebarProjectData(input: {
  projects: readonly Pick<Project, "id" | "cwd" | "expanded">[];
  sortedSidebarThreadsByProjectId: ReadonlyMap<ProjectId, SidebarThreadSummary[]>;
  pinnedThreadIds: readonly ThreadId[];
  expandedParentThreadIds: ReadonlySet<ThreadId>;
  threadListExtraPagesByProjectCwd: ReadonlyMap<string, number>;
  normalizeProjectCwd: (cwd: string) => string;
  activeSidebarThreadId: ThreadId | undefined;
  previewLimit: number;
  previewPageSize: number;
  resolveThreadStatus?: (
    thread: SidebarThreadSummary,
  ) => ReturnType<typeof resolveThreadStatusPill>;
}): ReadonlyMap<ProjectId, SidebarDerivedProjectData> {
  const byProjectId = new Map<ProjectId, SidebarDerivedProjectData>();

  for (const project of input.projects) {
    const allProjectThreads = input.sortedSidebarThreadsByProjectId.get(project.id) ?? [];
    const projectThreads = getUnpinnedThreadsForSidebar(allProjectThreads, input.pinnedThreadIds);
    const projectStatus = resolveProjectStatusIndicator(
      allProjectThreads.map((thread) =>
        input.resolveThreadStatus
          ? input.resolveThreadStatus(thread)
          : resolveThreadStatusPill({
              thread,
              hasPendingApprovals: thread.hasPendingApprovals,
              hasPendingUserInput: thread.hasPendingUserInput,
            }),
      ),
    );
    const requestedExtraPages =
      input.threadListExtraPagesByProjectCwd.get(input.normalizeProjectCwd(project.cwd)) ?? 0;
    const orderedProjectThreadIds = projectThreads.map((thread) => thread.id);

    // Collapsed folders should not build or render their full tree; large projects can
    // contain hundreds of rows and folder toggles are on the sidebar hot path.
    if (!project.expanded) {
      const activeThread =
        input.activeSidebarThreadId === undefined
          ? null
          : (projectThreads.find((thread) => thread.id === input.activeSidebarThreadId) ?? null);
      const childCount =
        activeThread === null
          ? 0
          : projectThreads.filter((thread) => thread.parentThreadId === activeThread.id).length;
      const visibleEntries =
        activeThread === null
          ? []
          : [
              {
                kind: "thread" as const,
                rowId: activeThread.id,
                rootRowId: activeThread.id,
                thread: activeThread,
                depth: 0,
                childCount,
                isExpanded: false,
              },
            ];

      byProjectId.set(project.id, {
        allProjectThreadCount: allProjectThreads.length,
        projectThreads,
        orderedProjectThreadIds,
        visibleEntries,
        // The thread list is hidden while the folder is closed, so paging affordances are moot.
        threadListExtraPages: 0,
        canShowMoreThreads: false,
        canShowLessThreads: false,
        activeEntryId: activeThread?.id ?? null,
        projectStatus,
      });
      continue;
    }

    const projectThreadTree = buildProjectThreadTree({
      threads: projectThreads,
      expandedParentThreadIds: input.expandedParentThreadIds,
    });
    const orderedEntries: SidebarProjectEntry[] = projectThreadTree.map(
      ({ thread, depth, rootThreadId, childCount, isExpanded }) => ({
        kind: "thread",
        rowId: thread.id,
        rootRowId: rootThreadId,
        thread,
        depth,
        childCount,
        isExpanded,
      }),
    );

    const activeEntry =
      input.activeSidebarThreadId === undefined
        ? null
        : (orderedEntries.find((entry) => entry.rowId === input.activeSidebarThreadId) ?? null);
    const paging = resolveSidebarThreadListPaging({
      totalCount: orderedEntries.length,
      baseLimit: input.previewLimit,
      pageSize: input.previewPageSize,
      requestedExtraPages,
    });
    const { visibleEntries: renderedEntries } = getVisibleSidebarEntriesForPreview({
      entries: orderedEntries,
      activeEntryId: activeEntry?.rowId,
      previewLimit: paging.previewLimit,
    });

    byProjectId.set(project.id, {
      allProjectThreadCount: allProjectThreads.length,
      projectThreads,
      orderedProjectThreadIds,
      visibleEntries: renderedEntries,
      threadListExtraPages: paging.effectiveExtraPages,
      // The active-thread reveal can force rows beyond the page cap; only offer "Show more"
      // while rows are genuinely hidden.
      canShowMoreThreads: paging.canShowMore && renderedEntries.length < orderedEntries.length,
      canShowLessThreads: paging.canShowLess,
      activeEntryId: activeEntry?.rowId ?? null,
      projectStatus,
    });
  }

  return byProjectId;
}
