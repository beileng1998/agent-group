// FILE: useSidebarLifecycleOwner.ts
// Purpose: Own sidebar startup shell recovery and visible thread-detail retention.
// Layer: Web sidebar lifecycle owner

import type { OrchestrationShellSnapshot, ThreadId } from "@agent-group/contracts";
import { useEffect } from "react";
import { getSidebarThreadIdsToPrewarm } from "../components/Sidebar.logic";
import { readNativeApi } from "../nativeApi";
import { retainThreadDetailSubscription } from "../threadDetailSubscriptionRetention";

export type SidebarLifecycleOwnerInput = {
  readonly projects: {
    readonly count: number;
  };
  readonly threads: {
    readonly hydrated: boolean;
    readonly visibleIds: readonly ThreadId[];
    readonly activeId: ThreadId | null;
  };
  readonly syncServerShellSnapshot: (snapshot: OrchestrationShellSnapshot) => void;
};

export function useSidebarLifecycleOwner(input: SidebarLifecycleOwnerInput): void {
  const { projects, threads, syncServerShellSnapshot } = input;

  useEffect(() => {
    const api = readNativeApi();
    if (!api || !threads.hydrated || projects.count > 0) {
      return;
    }

    let cancelled = false;
    // The sidebar is the visible empty-state owner. If startup hydrated empty
    // before the desktop projection caught up, ask the lightweight shell endpoint once.
    void api.orchestration
      .getShellSnapshot()
      .then((snapshot) => {
        if (cancelled || (snapshot.projects.length === 0 && snapshot.threads.length === 0)) {
          return;
        }
        syncServerShellSnapshot(snapshot);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [projects.count, syncServerShellSnapshot, threads.hydrated]);

  useEffect(() => {
    const threadIdsToPrewarm = getSidebarThreadIdsToPrewarm({
      visibleThreadIds: threads.visibleIds,
      activeThreadId: threads.activeId,
    });
    const releaseCallbacks = threadIdsToPrewarm.map((threadId) =>
      retainThreadDetailSubscription(threadId),
    );

    return () => {
      for (const release of releaseCallbacks) {
        release();
      }
    };
  }, [threads.activeId, threads.visibleIds]);
}
