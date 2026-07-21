// FILE: useSidebarVisibleThreadPrs.ts
// Purpose: Resolves pull-request badges for the sidebar's currently visible thread rows.
// Layer: Web sidebar view-model

import { useCallback, useMemo, type MouseEvent } from "react";
import { useQueries } from "@tanstack/react-query";
import { type GitStatusResult, type ProjectId, type ThreadId } from "@agent-group/contracts";
import { resolveThreadWorkspaceCwd } from "@agent-group/shared/threadEnvironment";
import { gitResolvePullRequestQueryOptions, gitStatusQueryOptions } from "../lib/gitReactQuery";
import { readNativeApi } from "../nativeApi";
import type { SidebarThreadSummary } from "../types";
import { toThreadPr, type ThreadPr } from "../components/sidebar/SidebarThreadPresentation";
import { toastManager } from "../components/ui/toast";

export type SidebarVisibleThreadPrsInput = {
  threads: {
    visible: readonly SidebarThreadSummary[];
  };
  projects: {
    cwdById: ReadonlyMap<ProjectId, string>;
  };
};

export function useSidebarVisibleThreadPrs(input: SidebarVisibleThreadPrsInput) {
  const { threads, projects } = input;
  const targets = useMemo(
    () =>
      threads.visible.map((thread) => ({
        threadId: thread.id,
        branch: thread.branch,
        lastKnownPr: thread.lastKnownPr ?? null,
        cwd: resolveThreadWorkspaceCwd({
          projectCwd: projects.cwdById.get(thread.projectId) ?? null,
          envMode: thread.envMode,
          worktreePath: thread.worktreePath,
        }),
      })),
    [projects.cwdById, threads.visible],
  );
  const statusCwds = useMemo(
    () => [
      ...new Set(
        targets
          .filter((target) => target.branch !== null)
          .map((target) => target.cwd)
          .filter((cwd): cwd is string => cwd !== null),
      ),
    ],
    [targets],
  );
  const statusQueries = useQueries({
    queries: statusCwds.map((cwd) => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const storedPrTargets = useMemo(
    () =>
      targets.flatMap((target) =>
        target.cwd !== null &&
        target.lastKnownPr !== null &&
        target.lastKnownPr.url.trim().length > 0
          ? [{ ...target, cwd: target.cwd, lastKnownPr: target.lastKnownPr }]
          : [],
      ),
    [targets],
  );
  const storedPrQueries = useQueries({
    queries: storedPrTargets.map((target) => ({
      ...gitResolvePullRequestQueryOptions({
        cwd: target.cwd,
        reference: target.lastKnownPr.url,
      }),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });

  const prByThreadId = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < statusCwds.length; index += 1) {
      const cwd = statusCwds[index];
      if (!cwd) continue;
      const status = statusQueries[index]?.data;
      if (status) {
        statusByCwd.set(cwd, status);
      }
    }

    const storedPrByThreadId = new Map<ThreadId, ThreadPr>();
    for (let index = 0; index < storedPrTargets.length; index += 1) {
      const target = storedPrTargets[index];
      if (!target) continue;
      const result = storedPrQueries[index]?.data?.pullRequest ?? null;
      if (result) {
        storedPrByThreadId.set(target.threadId, toThreadPr(result));
        continue;
      }
      storedPrByThreadId.set(target.threadId, toThreadPr(target.lastKnownPr));
    }

    const map = new Map<ThreadId, ThreadPr>();
    for (const target of targets) {
      const status = target.cwd ? statusByCwd.get(target.cwd) : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      const livePr = branchMatches ? (status?.pr ?? null) : null;
      map.set(target.threadId, livePr ?? storedPrByThreadId.get(target.threadId) ?? null);
    }
    return map;
  }, [statusCwds, statusQueries, storedPrQueries, storedPrTargets, targets]);

  const openPrLink = useCallback((event: MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  return {
    prByThreadId,
    openPrLink,
  };
}

export type SidebarVisibleThreadPrs = ReturnType<typeof useSidebarVisibleThreadPrs>;
