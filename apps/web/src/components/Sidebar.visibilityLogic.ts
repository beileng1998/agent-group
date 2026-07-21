// Sidebar rendered-thread visibility and keyboard navigation.

import type { KeybindingCommand, ProjectId } from "@agent-group/contracts";
import type { SidebarThreadSortOrder } from "../appSettings";
import type { Project, SidebarThreadSummary, Thread } from "../types";
import { SIDEBAR_THREAD_PREWARM_LIMIT } from "./Sidebar.presentationLogic";
import { sortThreadsForSidebar, type SidebarThreadSortInput } from "./Sidebar.sortingLogic";
import {
  buildProjectThreadTree,
  getVisibleSidebarEntriesForPreview,
  getVisibleThreadsForProject,
  resolveSidebarThreadListPaging,
} from "./Sidebar.treeLogic";

const THREAD_JUMP_COMMANDS = [
  "thread.jump.1",
  "thread.jump.2",
  "thread.jump.3",
  "thread.jump.4",
  "thread.jump.5",
  "thread.jump.6",
  "thread.jump.7",
  "thread.jump.8",
  "thread.jump.9",
] as const satisfies readonly KeybindingCommand[];

export type ProjectEmptyState = "loading" | "empty" | null;

// Keep the initial shell bootstrap visually distinct from a genuinely empty project list.
export function resolveProjectEmptyState(input: {
  readonly projectCount: number;
  readonly shouldShowProjectPathEntry: boolean;
  readonly threadsHydrated: boolean;
}): ProjectEmptyState {
  if (input.projectCount > 0 || input.shouldShowProjectPathEntry) {
    return null;
  }

  return input.threadsHydrated ? "empty" : "loading";
}

// Match the exact rows the sidebar renders for one project, including folded previews.
export function getRenderedThreadsForSidebarProject<
  T extends Pick<SidebarThreadSummary, "id"> & SidebarThreadSortInput,
>(input: {
  project: Pick<Project, "expanded">;
  threads: readonly T[];
  activeThreadId: Thread["id"] | undefined;
  previewLimit: number;
}): {
  hasHiddenThreads: boolean;
  renderedThreads: T[];
} {
  const { activeThreadId, previewLimit, project, threads } = input;
  const pinnedCollapsedThread =
    !project.expanded && activeThreadId
      ? (threads.find((thread) => thread.id === activeThreadId) ?? null)
      : null;
  const { hasHiddenThreads, visibleThreads } = getVisibleThreadsForProject({
    threads,
    activeThreadId,
    previewLimit,
  });

  return {
    hasHiddenThreads,
    renderedThreads: pinnedCollapsedThread ? [pinnedCollapsedThread] : visibleThreads,
  };
}

// Flatten the sidebar's current project/thread visibility into the same order the user sees.
export function getVisibleSidebarThreadIds(input: {
  projects: readonly Pick<Project, "id" | "expanded">[];
  threads: readonly (Pick<SidebarThreadSummary, "id" | "projectId" | "parentThreadId"> &
    SidebarThreadSortInput)[];
  activeThreadId: Thread["id"] | undefined;
  threadListExtraPagesByProjectId: ReadonlyMap<Project["id"], number>;
  expandedSubagentParentIds?: ReadonlySet<Thread["id"]>;
  previewLimit: number;
  previewPageSize: number;
  threadSortOrder: SidebarThreadSortOrder;
}): Thread["id"][] {
  const {
    activeThreadId,
    expandedSubagentParentIds,
    previewLimit,
    previewPageSize,
    projects,
    threadListExtraPagesByProjectId,
    threadSortOrder,
    threads,
  } = input;
  const visibleThreadIds: Thread["id"][] = [];
  const threadsByProjectId = new Map<ProjectId, (typeof threads)[number][]>();

  for (const thread of threads) {
    const projectThreads = threadsByProjectId.get(thread.projectId);
    if (projectThreads) {
      projectThreads.push(thread);
    } else {
      threadsByProjectId.set(thread.projectId, [thread]);
    }
  }

  for (const project of projects) {
    const projectThreads = sortThreadsForSidebar(
      threadsByProjectId.get(project.id) ?? [],
      threadSortOrder,
    );
    const projectThreadTree = buildProjectThreadTree({
      threads: projectThreads,
      expandedParentThreadIds: expandedSubagentParentIds,
    });
    const paging = resolveSidebarThreadListPaging({
      totalCount: projectThreadTree.length,
      baseLimit: previewLimit,
      pageSize: previewPageSize,
      requestedExtraPages: threadListExtraPagesByProjectId.get(project.id) ?? 0,
    });
    const { visibleEntries } = getVisibleSidebarEntriesForPreview({
      entries: projectThreadTree.map((row) => ({
        rowId: row.thread.id,
        rootRowId: row.rootThreadId,
        threadId: row.thread.id,
      })),
      activeEntryId: activeThreadId,
      previewLimit: paging.previewLimit,
    });
    const pinnedCollapsedThread =
      !project.expanded && activeThreadId
        ? (projectThreads.find((thread) => thread.id === activeThreadId) ?? null)
        : null;

    if (pinnedCollapsedThread) {
      visibleThreadIds.push(pinnedCollapsedThread.id);
      continue;
    }

    for (const entry of visibleEntries) {
      visibleThreadIds.push(entry.threadId);
    }
  }

  return visibleThreadIds;
}

// Resolve the next sidebar-visible thread for keyboard cycling with wraparound.
export function getNextVisibleSidebarThreadId(input: {
  visibleThreadIds: readonly Thread["id"][];
  activeThreadId: Thread["id"] | undefined;
  direction: "forward" | "backward";
}): Thread["id"] | null {
  const { activeThreadId, direction, visibleThreadIds } = input;
  if (visibleThreadIds.length === 0) {
    return null;
  }

  if (!activeThreadId) {
    return direction === "forward"
      ? (visibleThreadIds[0] ?? null)
      : (visibleThreadIds.at(-1) ?? null);
  }

  const activeIndex = visibleThreadIds.findIndex((threadId) => threadId === activeThreadId);
  if (activeIndex === -1) {
    return direction === "forward"
      ? (visibleThreadIds[0] ?? null)
      : (visibleThreadIds.at(-1) ?? null);
  }

  const nextIndex =
    direction === "forward"
      ? (activeIndex + 1) % visibleThreadIds.length
      : (activeIndex - 1 + visibleThreadIds.length) % visibleThreadIds.length;

  return visibleThreadIds[nextIndex] ?? null;
}

export function getSidebarThreadIdForJumpCommand(input: {
  visibleThreadIds: readonly Thread["id"][];
  command: string | null;
}): Thread["id"] | null {
  if (!input.command) {
    return null;
  }

  const jumpIndex = THREAD_JUMP_COMMANDS.indexOf(
    input.command as (typeof THREAD_JUMP_COMMANDS)[number],
  );
  if (jumpIndex === -1) {
    return null;
  }

  return input.visibleThreadIds[jumpIndex] ?? null;
}

export function getSidebarThreadIdsToPrewarm(input: {
  visibleThreadIds: readonly Thread["id"][];
  activeThreadId?: Thread["id"] | null;
  limit?: number;
  neighborRadius?: number;
}): Thread["id"][] {
  const limit = Math.max(0, input.limit ?? SIDEBAR_THREAD_PREWARM_LIMIT);
  if (limit === 0) {
    return [];
  }
  const prewarmedThreadIds = new Set<Thread["id"]>();
  const neighborRadius = Math.max(0, input.neighborRadius ?? 2);
  const activeIndex =
    input.activeThreadId === undefined || input.activeThreadId === null
      ? -1
      : input.visibleThreadIds.indexOf(input.activeThreadId);

  if (activeIndex >= 0) {
    const start = Math.max(0, activeIndex - neighborRadius);
    const end = Math.min(input.visibleThreadIds.length - 1, activeIndex + neighborRadius);
    for (let index = start; index <= end; index += 1) {
      if (prewarmedThreadIds.size >= limit) {
        break;
      }
      const threadId = input.visibleThreadIds[index];
      if (threadId) {
        prewarmedThreadIds.add(threadId);
      }
    }
  }

  for (const threadId of input.visibleThreadIds) {
    if (prewarmedThreadIds.size >= limit) {
      break;
    }
    prewarmedThreadIds.add(threadId);
  }

  return [...prewarmedThreadIds];
}
