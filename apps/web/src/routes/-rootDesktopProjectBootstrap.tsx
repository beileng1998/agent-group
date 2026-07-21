import { useEffect, useRef } from "react";

import { hasLiveThreadsWithMissingProjects } from "../lib/desktopProjectRecovery";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";

export function DesktopProjectBootstrap() {
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const attemptedRecoveryRef = useRef(false);

  useEffect(() => {
    const api = readNativeApi();
    if (!api || attemptedRecoveryRef.current || !threadsHydrated) return;

    const projectIds = new Set(projects.map((project) => project.id));
    const hasThreadWithoutProject = threads.some((thread) => !projectIds.has(thread.projectId));
    if (projects.length > 0 && !hasThreadWithoutProject) return;

    attemptedRecoveryRef.current = true;
    // Shell subscriptions should normally hydrate the sidebar. If project rows
    // are missing while live threads exist, repair before accepting the snapshot.
    void api.orchestration
      .getShellSnapshot()
      .then((snapshot) => {
        const needsRepair =
          (snapshot.projects.length === 0 && snapshot.threads.length === 0) ||
          hasLiveThreadsWithMissingProjects(snapshot);
        if (!needsRepair) {
          useStore.getState().syncServerShellSnapshot(snapshot);
          return snapshot;
        }
        return api.orchestration.repairState().then((repairedSnapshot) => {
          syncServerReadModel(repairedSnapshot);
          return repairedSnapshot;
        });
      })
      .catch(() => {
        attemptedRecoveryRef.current = false;
      });
  }, [projects, syncServerReadModel, threads, threadsHydrated]);

  return null;
}
