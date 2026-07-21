// FILE: useSidebarPinningOwner.ts
// Purpose: Own optimistic thread/project pinning, rollback, pruning, and legacy migration.
// Layer: Web sidebar controller

import { MAX_PINNED_PROJECTS, ProjectId, ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  derivePinnedProjectIdsForSidebar,
  derivePinnedThreadIdsForSidebar,
  isLatestPinnedProjectMutation,
  isLatestPinnedThreadMutation,
  orderPinnedProjectsForSidebar,
  shouldPrunePinnedThreads,
} from "../components/Sidebar.logic";
import { toastManager } from "../components/ui/toast";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { usePinnedProjectsStore } from "../pinnedProjectsStore";
import { usePinnedThreadsStore } from "../pinnedThreadsStore";
import type { Project, SidebarThreadSummary } from "../types";

interface UseSidebarPinningOwnerInput {
  projects: readonly Project[];
  sidebarDisplayThreads: readonly SidebarThreadSummary[];
  sidebarThreadSummaryById: Readonly<Record<string, SidebarThreadSummary>>;
  sidebarThreads: readonly SidebarThreadSummary[];
  standardProjectsBase: readonly Project[];
  threadsHydrated: boolean;
}

export function useSidebarPinningOwner({
  projects,
  sidebarDisplayThreads,
  sidebarThreadSummaryById,
  sidebarThreads,
  standardProjectsBase,
  threadsHydrated,
}: UseSidebarPinningOwnerInput) {
  const persistedPinnedProjectIds = usePinnedProjectsStore((store) => store.pinnedProjectIds);
  const pinProjectLocally = usePinnedProjectsStore((store) => store.pinProject);
  const unpinProject = usePinnedProjectsStore((store) => store.unpinProject);
  const prunePinnedProjects = usePinnedProjectsStore((store) => store.prunePinnedProjects);
  const persistedPinnedThreadIds = usePinnedThreadsStore((store) => store.pinnedThreadIds);
  const pinThreadLocally = usePinnedThreadsStore((store) => store.pinThread);
  const unpinThread = usePinnedThreadsStore((store) => store.unpinThread);
  const prunePinnedThreads = usePinnedThreadsStore((store) => store.prunePinnedThreads);
  const [optimisticPinnedStateByThreadId, setOptimisticPinnedStateByThreadId] = useState<
    ReadonlyMap<ThreadId, boolean>
  >(() => new Map());
  const [optimisticPinnedStateByProjectId, setOptimisticPinnedStateByProjectId] = useState<
    ReadonlyMap<ProjectId, boolean>
  >(() => new Map());
  const legacyPinMigrationThreadIdsRef = useRef(new Set<ThreadId>());
  const optimisticPinnedStateByProjectIdRef = useRef(new Map<ProjectId, boolean>());
  const latestPinnedMutationVersionByProjectIdRef = useRef(new Map<ProjectId, number>());
  const optimisticPinnedStateByThreadIdRef = useRef(new Map<ThreadId, boolean>());
  const latestPinnedMutationVersionByThreadIdRef = useRef(new Map<ThreadId, number>());
  const sidebarThreadSummaryByIdRef = useRef(sidebarThreadSummaryById);
  const projectByIdRef = useRef(new Map(projects.map((project) => [project.id, project] as const)));

  useEffect(() => {
    sidebarThreadSummaryByIdRef.current = sidebarThreadSummaryById;
  }, [sidebarThreadSummaryById]);
  useEffect(() => {
    projectByIdRef.current = new Map(projects.map((project) => [project.id, project] as const));
  }, [projects]);

  const pinnedThreadIds = useMemo(
    () =>
      derivePinnedThreadIdsForSidebar({
        threads: sidebarDisplayThreads,
        persistedPinnedThreadIds,
        optimisticPinnedStateByThreadId,
      }),
    [optimisticPinnedStateByThreadId, persistedPinnedThreadIds, sidebarDisplayThreads],
  );
  const pinnedThreadIdSet = useMemo(() => new Set(pinnedThreadIds), [pinnedThreadIds]);
  const pinnedProjectIds = useMemo(
    () =>
      derivePinnedProjectIdsForSidebar({
        projects: standardProjectsBase,
        persistedPinnedProjectIds,
        optimisticPinnedStateByProjectId,
      }),
    [optimisticPinnedStateByProjectId, persistedPinnedProjectIds, standardProjectsBase],
  );
  const pinnedProjectIdSet = useMemo(() => new Set(pinnedProjectIds), [pinnedProjectIds]);
  const standardProjects = useMemo(
    () => orderPinnedProjectsForSidebar(standardProjectsBase, pinnedProjectIds),
    [pinnedProjectIds, standardProjectsBase],
  );

  const setOptimisticThreadPinned = useCallback((threadId: ThreadId, isPinned: boolean) => {
    optimisticPinnedStateByThreadIdRef.current.set(threadId, isPinned);
    setOptimisticPinnedStateByThreadId((current) => {
      if (current.get(threadId) === isPinned) return current;
      const next = new Map(current);
      next.set(threadId, isPinned);
      return next;
    });
  }, []);
  const clearOptimisticThreadPinned = useCallback((threadId: ThreadId) => {
    optimisticPinnedStateByThreadIdRef.current.delete(threadId);
    setOptimisticPinnedStateByThreadId((current) => {
      if (!current.has(threadId)) return current;
      const next = new Map(current);
      next.delete(threadId);
      return next;
    });
  }, []);
  const dispatchThreadPinnedState = useCallback(async (threadId: ThreadId, isPinned: boolean) => {
    const api = readNativeApi();
    if (!api) return;
    await api.orchestration.dispatchCommand({
      type: "thread.meta.update",
      commandId: newCommandId(),
      threadId,
      isPinned,
    });
  }, []);
  const setThreadPinned = useCallback(
    async (threadId: ThreadId, isPinned: boolean) => {
      const api = readNativeApi();
      if (!api) return;
      const requestVersion =
        (latestPinnedMutationVersionByThreadIdRef.current.get(threadId) ?? 0) + 1;
      latestPinnedMutationVersionByThreadIdRef.current.set(threadId, requestVersion);
      setOptimisticThreadPinned(threadId, isPinned);
      if (isPinned) pinThreadLocally(threadId);
      else unpinThread(threadId);

      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          isPinned,
        });
      } catch (error) {
        if (
          !isLatestPinnedThreadMutation({
            threadId,
            requestVersion,
            latestMutationVersionByThreadId: latestPinnedMutationVersionByThreadIdRef.current,
          })
        )
          return;
        const confirmedPinned = sidebarThreadSummaryByIdRef.current[threadId]?.isPinned === true;
        if (confirmedPinned) pinThreadLocally(threadId);
        else unpinThread(threadId);
        clearOptimisticThreadPinned(threadId);
        throw error;
      }
    },
    [clearOptimisticThreadPinned, pinThreadLocally, setOptimisticThreadPinned, unpinThread],
  );
  const toggleThreadPinned = useCallback(
    (threadId: ThreadId) => {
      const isPinned = pinnedThreadIdSet.has(threadId);
      void setThreadPinned(threadId, !isPinned).catch((error) => {
        console.error("Failed to update pinned thread state", { threadId, error });
        toastManager.add({
          type: "error",
          title: isPinned ? "Unable to unpin thread" : "Unable to pin thread",
        });
      });
    },
    [pinnedThreadIdSet, setThreadPinned],
  );

  const setOptimisticProjectPinned = useCallback((projectId: ProjectId, isPinned: boolean) => {
    optimisticPinnedStateByProjectIdRef.current.set(projectId, isPinned);
    setOptimisticPinnedStateByProjectId((current) => {
      if (current.get(projectId) === isPinned) return current;
      const next = new Map(current);
      next.set(projectId, isPinned);
      return next;
    });
  }, []);
  const clearOptimisticProjectPinned = useCallback((projectId: ProjectId) => {
    optimisticPinnedStateByProjectIdRef.current.delete(projectId);
    setOptimisticPinnedStateByProjectId((current) => {
      if (!current.has(projectId)) return current;
      const next = new Map(current);
      next.delete(projectId);
      return next;
    });
  }, []);
  const dispatchProjectPinnedState = useCallback(
    async (projectId: ProjectId, isPinned: boolean) => {
      const api = readNativeApi();
      if (!api) return;
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId,
        isPinned,
      });
    },
    [],
  );
  const setProjectPinned = useCallback(
    async (projectId: ProjectId, isPinned: boolean) => {
      const project = projectByIdRef.current.get(projectId);
      if (!readNativeApi() || !project || project.kind !== "project") return;
      const requestVersion =
        (latestPinnedMutationVersionByProjectIdRef.current.get(projectId) ?? 0) + 1;
      latestPinnedMutationVersionByProjectIdRef.current.set(projectId, requestVersion);
      setOptimisticProjectPinned(projectId, isPinned);
      if (isPinned) {
        const accepted = pinProjectLocally(projectId);
        if (!accepted) {
          clearOptimisticProjectPinned(projectId);
          toastManager.add({
            type: "warning",
            title: "Project pin limit reached",
            description: `You can pin up to ${MAX_PINNED_PROJECTS} projects.`,
          });
          return;
        }
      } else unpinProject(projectId);

      try {
        await dispatchProjectPinnedState(projectId, isPinned);
      } catch (error) {
        if (
          !isLatestPinnedProjectMutation({
            projectId,
            requestVersion,
            latestMutationVersionByProjectId: latestPinnedMutationVersionByProjectIdRef.current,
          })
        )
          return;
        const confirmedPinned = projectByIdRef.current.get(projectId)?.isPinned === true;
        if (confirmedPinned) pinProjectLocally(projectId);
        else unpinProject(projectId);
        clearOptimisticProjectPinned(projectId);
        throw error;
      }
    },
    [
      clearOptimisticProjectPinned,
      dispatchProjectPinnedState,
      pinProjectLocally,
      setOptimisticProjectPinned,
      unpinProject,
    ],
  );
  const toggleProjectPinned = useCallback(
    (projectId: ProjectId) => {
      const optimisticPinned = optimisticPinnedStateByProjectIdRef.current.get(projectId);
      const locallyPinned = usePinnedProjectsStore.getState().pinnedProjectIds.includes(projectId);
      const serverPinned = projectByIdRef.current.get(projectId)?.isPinned === true;
      const isPinned = optimisticPinned ?? (locallyPinned || serverPinned);
      void setProjectPinned(projectId, !isPinned).catch((error) => {
        console.error("Failed to update pinned project state", { projectId, error });
        toastManager.add({
          type: "error",
          title: isPinned ? "Unable to unpin project" : "Unable to pin project",
          description: error instanceof Error ? error.message : undefined,
        });
      });
    },
    [setProjectPinned],
  );

  useEffect(() => {
    if (optimisticPinnedStateByThreadId.size === 0) return;
    const serverPinnedStateByThreadId = new Map(
      sidebarThreads.map((thread) => [thread.id, thread.isPinned === true] as const),
    );
    setOptimisticPinnedStateByThreadId((current) => {
      let next: Map<ThreadId, boolean> | null = null;
      const confirmedThreadIds: ThreadId[] = [];
      for (const [threadId, desiredPinned] of current) {
        const serverPinned = serverPinnedStateByThreadId.get(threadId);
        if (serverPinned !== undefined && serverPinned !== desiredPinned) continue;
        next ??= new Map(current);
        next.delete(threadId);
        confirmedThreadIds.push(threadId);
      }
      if (next) {
        for (const threadId of confirmedThreadIds) {
          optimisticPinnedStateByThreadIdRef.current.delete(threadId);
        }
      }
      return next ?? current;
    });
  }, [optimisticPinnedStateByThreadId, sidebarThreads]);
  useEffect(() => {
    if (optimisticPinnedStateByProjectId.size === 0) return;
    const serverPinnedStateByProjectId = new Map(
      projects.map((project) => [project.id, project.isPinned === true] as const),
    );
    setOptimisticPinnedStateByProjectId((current) => {
      let next: Map<ProjectId, boolean> | null = null;
      const confirmedProjectIds: ProjectId[] = [];
      for (const [projectId, desiredPinned] of current) {
        const serverPinned = serverPinnedStateByProjectId.get(projectId);
        if (serverPinned !== undefined && serverPinned !== desiredPinned) continue;
        next ??= new Map(current);
        next.delete(projectId);
        confirmedProjectIds.push(projectId);
      }
      if (next) {
        for (const projectId of confirmedProjectIds) {
          optimisticPinnedStateByProjectIdRef.current.delete(projectId);
        }
      }
      return next ?? current;
    });
  }, [optimisticPinnedStateByProjectId, projects]);
  useEffect(() => {
    if (!shouldPrunePinnedThreads({ threadsHydrated })) return;
    prunePinnedThreads(sidebarThreads.map((thread) => thread.id));
  }, [prunePinnedThreads, sidebarThreads, threadsHydrated]);
  useEffect(() => {
    if (!threadsHydrated) return;
    prunePinnedProjects(standardProjectsBase.map((project) => project.id));
  }, [prunePinnedProjects, standardProjectsBase, threadsHydrated]);
  useEffect(() => {
    if (!threadsHydrated || persistedPinnedThreadIds.length === 0) return;
    const threadsById = new Map(sidebarThreads.map((thread) => [thread.id, thread] as const));
    for (const threadId of persistedPinnedThreadIds) {
      const thread = threadsById.get(threadId);
      if (
        !thread ||
        thread.isPinned === true ||
        optimisticPinnedStateByThreadIdRef.current.has(threadId) ||
        legacyPinMigrationThreadIdsRef.current.has(threadId)
      )
        continue;
      legacyPinMigrationThreadIdsRef.current.add(threadId);
      void dispatchThreadPinnedState(threadId, true)
        .catch((error) =>
          console.error("Failed to migrate pinned thread state", { threadId, error }),
        )
        .finally(() => legacyPinMigrationThreadIdsRef.current.delete(threadId));
    }
  }, [dispatchThreadPinnedState, persistedPinnedThreadIds, sidebarThreads, threadsHydrated]);

  return {
    pinnedProjectIds,
    pinnedProjectIdSet,
    pinnedThreadIds,
    pinnedThreadIdSet,
    standardProjects,
    toggleProjectPinned,
    toggleThreadPinned,
    unpinThread,
  };
}
