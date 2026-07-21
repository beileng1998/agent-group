// Sidebar thread-tree construction, pagination, and preview visibility.

import type { Project, SidebarThreadSummary, Thread } from "../types";

export function pruneProjectThreadListPagingForCollapsedProjects<
  T extends Pick<Project, "cwd" | "expanded">,
>(input: {
  threadListExtraPagesByProjectCwd: ReadonlyMap<string, number>;
  projects: readonly T[];
  normalizeProjectCwd: (cwd: string) => string;
}): ReadonlyMap<string, number> {
  const { normalizeProjectCwd, projects, threadListExtraPagesByProjectCwd } = input;
  const collapsedProjectCwds = new Set(
    projects
      .filter((project) => !project.expanded)
      .map((project) => normalizeProjectCwd(project.cwd))
      .filter((cwd) => cwd.length > 0),
  );

  if (collapsedProjectCwds.size === 0) {
    return threadListExtraPagesByProjectCwd;
  }

  let changed = false;
  const nextThreadListExtraPagesByProjectCwd = new Map<string, number>();
  for (const [cwd, extraPages] of threadListExtraPagesByProjectCwd) {
    if (collapsedProjectCwds.has(cwd)) {
      changed = true;
      continue;
    }
    nextThreadListExtraPagesByProjectCwd.set(cwd, extraPages);
  }

  return changed ? nextThreadListExtraPagesByProjectCwd : threadListExtraPagesByProjectCwd;
}

// One "Show more" click reveals one extra page of rows; "Show less" hides one page again.
// The requested page count is clamped to what the list can actually use, so stale persisted
// values (or shrinking thread lists) self-heal instead of requiring dead "Show less" clicks.
export type SidebarThreadListPaging = {
  /** Requested pages clamped to what `totalCount` can actually consume. */
  effectiveExtraPages: number;
  /** Row cap to render: `baseLimit + effectiveExtraPages * pageSize`. */
  previewLimit: number;
  canShowMore: boolean;
  canShowLess: boolean;
};

export function resolveSidebarThreadListPaging(input: {
  totalCount: number;
  baseLimit: number;
  pageSize: number;
  requestedExtraPages: number;
}): SidebarThreadListPaging {
  const { baseLimit, pageSize, totalCount } = input;
  const hiddenBeyondBase = Math.max(0, totalCount - baseLimit);
  const maxExtraPages = pageSize > 0 ? Math.ceil(hiddenBeyondBase / pageSize) : 0;
  const requestedExtraPages = Number.isFinite(input.requestedExtraPages)
    ? Math.floor(input.requestedExtraPages)
    : 0;
  const effectiveExtraPages = Math.min(Math.max(0, requestedExtraPages), maxExtraPages);
  const previewLimit = baseLimit + effectiveExtraPages * pageSize;

  return {
    effectiveExtraPages,
    previewLimit,
    canShowMore: totalCount > previewLimit,
    canShowLess: effectiveExtraPages > 0,
  };
}

export function getVisibleThreadsForProject<T extends Pick<SidebarThreadSummary, "id">>(input: {
  threads: readonly T[];
  activeThreadId: Thread["id"] | undefined;
  previewLimit: number;
}): {
  hasHiddenThreads: boolean;
  visibleThreads: T[];
} {
  const { activeThreadId, previewLimit, threads } = input;
  const hasHiddenThreads = threads.length > previewLimit;

  if (!hasHiddenThreads) {
    return {
      hasHiddenThreads,
      visibleThreads: [...threads],
    };
  }

  const previewThreads = threads.slice(0, previewLimit);
  if (!activeThreadId || previewThreads.some((thread) => thread.id === activeThreadId)) {
    return {
      hasHiddenThreads: true,
      visibleThreads: previewThreads,
    };
  }

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  if (!activeThread) {
    return {
      hasHiddenThreads: true,
      visibleThreads: previewThreads,
    };
  }

  const visibleThreadIds = new Set([...previewThreads, activeThread].map((thread) => thread.id));

  return {
    hasHiddenThreads: true,
    visibleThreads: threads.filter((thread) => visibleThreadIds.has(thread.id)),
  };
}

export interface SidebarThreadTreeRow<
  T extends Pick<SidebarThreadSummary, "id" | "parentThreadId">,
> {
  thread: T;
  depth: number;
  rootThreadId: T["id"];
  childCount: number;
  isExpanded: boolean;
}

function collectForcedExpandedParentIds<
  T extends Pick<SidebarThreadSummary, "id" | "parentThreadId">,
>(threadById: Map<T["id"], T>, forceVisibleThreadId: T["id"] | undefined): Set<T["id"]> {
  const forcedParentIds = new Set<T["id"]>();
  let currentThreadId = forceVisibleThreadId;

  while (currentThreadId) {
    const parentThreadId = threadById.get(currentThreadId)?.parentThreadId ?? undefined;
    if (!parentThreadId) {
      break;
    }
    forcedParentIds.add(parentThreadId);
    currentThreadId = parentThreadId;
  }

  return forcedParentIds;
}

// Build the project-local parent/child thread tree while preserving sort order from the input list.
export function buildProjectThreadTree<
  T extends Pick<SidebarThreadSummary, "id" | "parentThreadId">,
>(input: {
  threads: readonly T[];
  expandedParentThreadIds?: ReadonlySet<T["id"]> | undefined;
  forceVisibleThreadId?: T["id"] | undefined;
}): SidebarThreadTreeRow<T>[] {
  const { expandedParentThreadIds, forceVisibleThreadId, threads } = input;
  const threadById = new Map(threads.map((thread) => [thread.id, thread] as const));
  const childrenByParentId = new Map<T["id"], T[]>();
  const roots: T[] = [];

  for (const thread of threads) {
    const parentThreadId = thread.parentThreadId ?? null;
    if (!parentThreadId || !threadById.has(parentThreadId)) {
      roots.push(thread);
      continue;
    }
    const siblings = childrenByParentId.get(parentThreadId) ?? [];
    siblings.push(thread);
    childrenByParentId.set(parentThreadId, siblings);
  }

  const forcedExpandedParentIds = collectForcedExpandedParentIds(threadById, forceVisibleThreadId);
  const orderedRows: SidebarThreadTreeRow<T>[] = [];

  const visit = (thread: T, depth: number, rootThreadId: T["id"]) => {
    const childThreads = childrenByParentId.get(thread.id) ?? [];
    const isExpanded =
      childThreads.length > 0 &&
      (expandedParentThreadIds?.has(thread.id) === true || forcedExpandedParentIds.has(thread.id));

    orderedRows.push({
      thread,
      depth,
      rootThreadId,
      childCount: childThreads.length,
      isExpanded,
    });

    if (!isExpanded) {
      return;
    }

    for (const child of childThreads) {
      visit(child, depth + 1, rootThreadId);
    }
  };

  for (const root of roots) {
    visit(root, 0, root.id);
  }

  return orderedRows;
}

export function getVisibleSidebarEntriesForPreview<
  T extends {
    rowId: Thread["id"];
    rootRowId: Thread["id"];
  },
>(input: {
  entries: readonly T[];
  activeEntryId: Thread["id"] | undefined;
  previewLimit: number;
}): {
  hasHiddenEntries: boolean;
  visibleEntries: T[];
} {
  const { activeEntryId, entries, previewLimit } = input;
  const hasHiddenEntries = entries.length > previewLimit;

  if (!hasHiddenEntries) {
    return {
      hasHiddenEntries,
      visibleEntries: [...entries],
    };
  }

  const previewEntries = entries.slice(0, previewLimit);
  const visibleEntryIds = new Set(previewEntries.map((entry) => entry.rowId));

  if (!activeEntryId || visibleEntryIds.has(activeEntryId)) {
    return {
      hasHiddenEntries: true,
      visibleEntries: previewEntries,
    };
  }

  const activeEntryIndex = entries.findIndex((entry) => entry.rowId === activeEntryId);
  if (activeEntryIndex === -1) {
    return {
      hasHiddenEntries: true,
      visibleEntries: previewEntries,
    };
  }

  const activeEntry = entries[activeEntryIndex];
  if (!activeEntry) {
    return {
      hasHiddenEntries: true,
      visibleEntries: previewEntries,
    };
  }

  const rootEntryIndex = entries.findIndex((entry) => entry.rowId === activeEntry.rootRowId);
  const forcedVisibleEntries =
    rootEntryIndex === -1 ? [activeEntry] : entries.slice(rootEntryIndex, activeEntryIndex + 1);

  for (const entry of forcedVisibleEntries) {
    visibleEntryIds.add(entry.rowId);
  }

  return {
    hasHiddenEntries: true,
    visibleEntries: entries.filter((entry) => visibleEntryIds.has(entry.rowId)),
  };
}
