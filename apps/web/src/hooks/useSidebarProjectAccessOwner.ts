// FILE: useSidebarProjectAccessOwner.ts
// Purpose: Own sidebar project opening, creation recovery, and add-project UI state.
// Layer: Web sidebar controller

import { ProjectId, type OrchestrationShellSnapshot } from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import type { AppSettings } from "../appSettings";
import {
  describeAddProjectError,
  findWorkspaceRootMatch,
  recoverExistingAddProjectTarget,
  resolveSidebarNewThreadEnvMode,
  sortThreadsForSidebar,
} from "../components/Sidebar.logic";
import { toastManager } from "../components/ui/toast";
import {
  createOrRecoverProjectFromPath,
  PROJECT_CREATE_EXISTING_SYNC_ERROR,
} from "../lib/projectCreation";
import { waitForRecoverableProjectInReadModel } from "../lib/projectCreateRecovery";
import { resolveCurrentProjectTargetId } from "../lib/projectShortcutTargets";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import type { Project, SidebarThreadSummary } from "../types";
import type { useHandleNewThread } from "./useHandleNewThread";

const SNAPSHOT_CATCH_UP_MAX_ATTEMPTS = 6;
const SNAPSHOT_CATCH_UP_DELAY_MS = 50;

type HandleNewThread = ReturnType<typeof useHandleNewThread>["handleNewThread"];

interface UseSidebarProjectAccessOwnerInput {
  readonly projects: readonly Project[];
  readonly sidebarThreads: readonly SidebarThreadSummary[];
  readonly focusedProjectId: ProjectId | null;
  readonly threadSortOrder: AppSettings["sidebarThreadSortOrder"];
  readonly defaultEnvMode: AppSettings["defaultThreadEnvMode"];
  readonly onNewThread: HandleNewThread;
}

function latestProjectThread(
  projectId: ProjectId,
  snapshot: OrchestrationShellSnapshot,
  sortOrder: AppSettings["sidebarThreadSortOrder"],
) {
  return sortThreadsForSidebar(
    snapshot.threads
      .filter((thread) => thread.projectId === projectId && (thread.archivedAt ?? null) === null)
      .map((thread) => ({
        id: thread.id,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        latestUserMessageAt: thread.latestUserMessageAt,
      })),
    sortOrder,
  )[0];
}

export function useSidebarProjectAccessOwner({
  projects,
  sidebarThreads,
  focusedProjectId,
  threadSortOrder,
  defaultEnvMode,
  onNewThread,
}: UseSidebarProjectAccessOwnerInput) {
  const navigate = useNavigate();
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const setProjectExpanded = useStore((store) => store.setProjectExpanded);
  const [open, setOpen] = useState(false);
  const [cwd, setCwdState] = useState("");
  const [pickingFolder, setPickingFolder] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorMeaning = useMemo(() => (error ? describeAddProjectError(error) : null), [error]);
  const targetProjectId = useMemo(
    () => resolveCurrentProjectTargetId(projects, focusedProjectId),
    [focusedProjectId, projects],
  );

  const openSnapshotProject = useCallback(
    async (
      projectId: ProjectId,
      snapshot: OrchestrationShellSnapshot,
      requireProject: boolean,
    ): Promise<boolean> => {
      if (requireProject && !snapshot.projects.some((project) => project.id === projectId)) {
        return false;
      }
      const latestThread = latestProjectThread(projectId, snapshot, threadSortOrder);
      if (latestThread) {
        await navigate({ to: "/$threadId", params: { threadId: latestThread.id } });
        return true;
      }
      if (requireProject) setProjectExpanded(projectId, true);
      void onNewThread(projectId, { envMode: defaultEnvMode }).catch(() => undefined);
      return true;
    },
    [defaultEnvMode, navigate, onNewThread, setProjectExpanded, threadSortOrder],
  );

  const recoverProject = useCallback(
    async (
      api: NonNullable<ReturnType<typeof readNativeApi>>,
      target: { projectId: ProjectId } | { workspaceRoot: string },
    ): Promise<boolean> => {
      const result = await waitForRecoverableProjectInReadModel({
        ...target,
        loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
        maxAttempts: SNAPSHOT_CATCH_UP_MAX_ATTEMPTS,
        delayMs: SNAPSHOT_CATCH_UP_DELAY_MS,
      });
      if (result.snapshot) syncServerShellSnapshot(result.snapshot);
      if (!result.project || !result.snapshot) return false;
      return openSnapshotProject(result.project.id, result.snapshot, true);
    },
    [openSnapshotProject, syncServerShellSnapshot],
  );

  const addFromPath = useCallback(
    async (rawCwd: string, options: { createIfMissing?: boolean } = {}) => {
      const workspaceRoot = rawCwd.trim();
      if (!workspaceRoot || adding) return;
      const api = readNativeApi();
      if (!api) return;

      setAdding(true);
      const finish = () => {
        setAdding(false);
        setCwdState("");
        setError(null);
        setOpen(false);
      };
      try {
        const existing = findWorkspaceRootMatch(projects, workspaceRoot, (project) => project.cwd);
        const recovered = await recoverExistingAddProjectTarget({
          existingProjectId: existing?.id,
          workspaceRoot,
          recoverByProjectId: (projectId) => recoverProject(api, { projectId }),
          recoverByWorkspaceRoot: (root) => recoverProject(api, { workspaceRoot: root }),
        });
        if (recovered === "recovered") {
          finish();
          return;
        }

        const creation = await createOrRecoverProjectFromPath({
          api,
          workspaceRoot,
          ...(options.createIfMissing === undefined
            ? {}
            : { createIfMissing: options.createIfMissing }),
          loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
          maxAttempts: SNAPSHOT_CATCH_UP_MAX_ATTEMPTS,
          delayMs: SNAPSHOT_CATCH_UP_DELAY_MS,
        });
        if (creation.snapshot) syncServerShellSnapshot(creation.snapshot);
        if (creation.project && creation.snapshot) {
          const opened = await openSnapshotProject(
            creation.project.id,
            creation.snapshot,
            !creation.created,
          );
          if (opened) {
            finish();
            return;
          }
        }
        if (!creation.created) {
          if (await recoverProject(api, { projectId: creation.projectId })) {
            finish();
            return;
          }
          setAdding(false);
          throw new Error(PROJECT_CREATE_EXISTING_SYNC_ERROR);
        }

        setProjectExpanded(creation.projectId, true);
        void onNewThread(creation.projectId, { envMode: defaultEnvMode }).catch(() => undefined);
        finish();
      } catch (cause) {
        setAdding(false);
        const description =
          cause instanceof Error ? cause.message : "An error occurred while adding the project.";
        throw cause instanceof Error ? cause : new Error(description);
      }
    },
    [
      adding,
      defaultEnvMode,
      onNewThread,
      openSnapshotProject,
      projects,
      recoverProject,
      setProjectExpanded,
      syncServerShellSnapshot,
    ],
  );

  const submit = useCallback(() => {
    void addFromPath(cwd, { createIfMissing: true }).catch((cause: unknown) => {
      setError(
        cause instanceof Error ? cause.message : "An error occurred while adding the project.",
      );
    });
  }, [addFromPath, cwd]);
  const pickFolder = useCallback(async () => {
    const api = readNativeApi();
    if (!api || pickingFolder) return;
    setPickingFolder(true);
    try {
      const pickedPath = await api.dialogs.pickFolder();
      setPickingFolder(false);
      if (!pickedPath) return;
      setError(null);
      await addFromPath(pickedPath).catch((cause: unknown) => {
        const description =
          cause instanceof Error ? cause.message : "An error occurred while adding the project.";
        setError(description);
        toastManager.add({ type: "error", title: "Unable to add project", description });
      });
    } catch (cause) {
      const description =
        cause instanceof Error ? cause.message : "Unable to open the folder picker.";
      setError(description);
      toastManager.add({ type: "error", title: "Unable to open folder picker", description });
      setPickingFolder(false);
    }
  }, [addFromPath, pickingFolder]);
  const toggle = useCallback(() => {
    setError(null);
    setManualEntry(false);
    setOpen((current) => !current);
  }, []);
  const setCwd = useCallback((value: string) => {
    setCwdState(value);
    setError(null);
  }, []);
  const cancelManual = useCallback(() => {
    setManualEntry(false);
    setError(null);
  }, []);

  const openProjectFromSearch = useCallback(
    (projectId: string) => {
      const typedProjectId = ProjectId.makeUnsafe(projectId);
      const latestThread = sortThreadsForSidebar(
        sidebarThreads.filter((thread) => thread.projectId === typedProjectId),
        threadSortOrder,
      )[0];
      if (latestThread) {
        void navigate({ to: "/$threadId", params: { threadId: latestThread.id } });
        return;
      }
      void onNewThread(typedProjectId, {
        envMode: resolveSidebarNewThreadEnvMode({ defaultEnvMode }),
      });
    },
    [defaultEnvMode, navigate, onNewThread, sidebarThreads, threadSortOrder],
  );
  const createPrimaryThread = useCallback(() => {
    if (!targetProjectId) {
      toggle();
      return;
    }
    void onNewThread(targetProjectId, {
      envMode: resolveSidebarNewThreadEnvMode({ defaultEnvMode }),
    });
  }, [defaultEnvMode, onNewThread, targetProjectId, toggle]);

  return {
    model: {
      open,
      cwd,
      pickingFolder,
      manualEntry,
      adding,
      error,
      errorMeaning,
      canSubmit: cwd.trim().length > 0 && !adding,
      targetProjectId,
    },
    actions: {
      toggle,
      showManual: () => setManualEntry(true),
      cancelManual,
      setCwd,
      submit,
      pickFolder,
      addFromPath,
      openProjectFromSearch,
      createPrimaryThread,
      clearError: () => setError(null),
    },
  };
}

export type SidebarProjectAccessOwner = ReturnType<typeof useSidebarProjectAccessOwner>;
