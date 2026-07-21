// Sidebar project and thread pinning helpers.

import { MAX_PINNED_PROJECTS } from "@agent-group/contracts";
import type { Project, Thread } from "../types";
import {
  derivePinnedIds,
  getPinnedItems,
  isLatestPinMutation,
  orderPinnedItemsFirst,
} from "../pinning.logic";

export function getPinnedThreadsForSidebar<T extends Pick<Thread, "id">>(
  threads: readonly T[],
  pinnedThreadIds: readonly T["id"][],
): T[] {
  return getPinnedItems(threads, pinnedThreadIds);
}

// Resolve the visible pinned ids from server state, local legacy pins, and pending user clicks.
export function derivePinnedThreadIdsForSidebar<T extends Pick<Thread, "id" | "isPinned">>(input: {
  readonly threads: readonly T[];
  readonly persistedPinnedThreadIds: readonly T["id"][];
  readonly optimisticPinnedStateByThreadId: ReadonlyMap<T["id"], boolean>;
}): T["id"][] {
  return derivePinnedIds({
    items: input.threads,
    persistedPinnedIds: input.persistedPinnedThreadIds,
    optimisticPinnedStateById: input.optimisticPinnedStateByThreadId,
  });
}

// Only the newest pin mutation may roll back optimistic state after rapid clicks.
export function isLatestPinnedThreadMutation<T>(input: {
  readonly threadId: T;
  readonly requestVersion: number;
  readonly latestMutationVersionByThreadId: ReadonlyMap<T, number>;
}): boolean {
  return isLatestPinMutation({
    id: input.threadId,
    requestVersion: input.requestVersion,
    latestMutationVersionById: input.latestMutationVersionByThreadId,
  });
}

export function isLatestPinnedProjectMutation<T>(input: {
  readonly projectId: T;
  readonly requestVersion: number;
  readonly latestMutationVersionByProjectId: ReadonlyMap<T, number>;
}): boolean {
  return isLatestPinMutation({
    id: input.projectId,
    requestVersion: input.requestVersion,
    latestMutationVersionById: input.latestMutationVersionByProjectId,
  });
}

export function derivePinnedProjectIdsForSidebar<
  T extends Pick<Project, "id" | "isPinned">,
>(input: {
  readonly projects: readonly T[];
  readonly persistedPinnedProjectIds: readonly T["id"][];
  readonly optimisticPinnedStateByProjectId: ReadonlyMap<T["id"], boolean>;
}): T["id"][] {
  return derivePinnedIds({
    items: input.projects,
    persistedPinnedIds: input.persistedPinnedProjectIds,
    optimisticPinnedStateById: input.optimisticPinnedStateByProjectId,
    maxCount: MAX_PINNED_PROJECTS,
  });
}

export function orderPinnedProjectsForSidebar<T extends Pick<Project, "id">>(
  projects: readonly T[],
  pinnedProjectIds: readonly T["id"][],
): T[] {
  return orderPinnedItemsFirst(projects, pinnedProjectIds);
}

// Hide globally pinned rows from the per-project lists so the sidebar doesn't duplicate chats.
export function getUnpinnedThreadsForSidebar<T extends Pick<Thread, "id">>(
  threads: readonly T[],
  pinnedThreadIds: readonly T["id"][],
): T[] {
  if (pinnedThreadIds.length === 0) {
    return [...threads];
  }

  const pinnedThreadIdSet = new Set(pinnedThreadIds);
  return threads.filter((thread) => !pinnedThreadIdSet.has(thread.id));
}

// Only prune persisted pins after the thread snapshot has hydrated.
export function shouldPrunePinnedThreads(input: { threadsHydrated: boolean }): boolean {
  return input.threadsHydrated;
}
