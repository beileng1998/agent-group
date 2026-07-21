// FILE: useSidebarProjectMenuOwner.ts
// Purpose: Own sidebar project context-menu commands, removal, and rename state.
// Layer: Web sidebar controller

import type { ProjectId } from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import {
  createClientPointMenuAnchor,
  type ProjectContextMenuId,
  type ProjectContextMenuState,
} from "../components/sidebar/SidebarProjectContextMenuValues";
import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { useCopyPathToClipboard } from "./useCopyToClipboard";
import { deleteProjectFromClient } from "../lib/projectDelete";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import type { Project, SidebarThreadSummary } from "../types";
import type {
  DeleteProjectThreadsOptions,
  DeleteProjectThreadsResult,
} from "./useSidebarThreadDeleteOwner";

interface UseSidebarProjectMenuOwnerInput {
  readonly projects: readonly Project[];
  readonly sidebarThreads: readonly SidebarThreadSummary[];
  readonly pinnedProjectIds: ReadonlySet<ProjectId>;
  readonly projectRunsByProjectId: Readonly<Record<string, unknown>>;
  readonly canOpenServer: (projectId: ProjectId) => boolean;
  readonly openRunDialog: (projectId: ProjectId) => void;
  readonly stopRun: (projectId: ProjectId) => Promise<void>;
  readonly openServer: (projectId: ProjectId) => Promise<void>;
  readonly togglePinned: (projectId: ProjectId) => void;
  readonly archiveAllThreads: (projectId: ProjectId) => Promise<void>;
  readonly deleteAllThreads: (projectId: ProjectId) => Promise<void>;
  readonly deleteProjectThreads: (
    projectId: ProjectId,
    options?: DeleteProjectThreadsOptions,
  ) => Promise<DeleteProjectThreadsResult | null>;
}

export function useSidebarProjectMenuOwner({
  projects,
  sidebarThreads,
  pinnedProjectIds,
  projectRunsByProjectId,
  canOpenServer,
  openRunDialog,
  stopRun,
  openServer,
  togglePinned,
  archiveAllThreads,
  deleteAllThreads,
  deleteProjectThreads,
}: UseSidebarProjectMenuOwnerInput) {
  const navigate = useNavigate();
  const copyPath = useCopyPathToClipboard();
  const clearProjectDraftThreads = useComposerDraftStore((store) => store.clearProjectDraftThreads);
  const removeDeletedProjectFromClientState = useStore(
    (store) => store.removeDeletedProjectFromClientState,
  );
  const renameProjectLocally = useStore((store) => store.renameProjectLocally);
  const [contextMenu, setContextMenu] = useState<ProjectContextMenuState | null>(null);
  const [renameProjectId, setRenameProjectId] = useState<ProjectId | null>(null);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );

  const runAction = useCallback(
    async (projectId: ProjectId, action: ProjectContextMenuId) => {
      setContextMenu(null);
      const api = readNativeApi();
      const project = projectById.get(projectId);
      if (!api || !project) return;

      if (action === "open-in-finder") {
        try {
          await api.shell.showInFolder(project.cwd);
        } catch (cause) {
          toastManager.add({
            type: "error",
            title: "Unable to open in Finder",
            description:
              cause instanceof Error
                ? cause.message
                : "An unknown error occurred opening the folder.",
          });
        }
        return;
      }
      if (action === "open-in-kanban") {
        void navigate({ to: "/kanban/$projectId", params: { projectId } });
        return;
      }
      if (action === "copy-path") {
        copyPath(project.cwd);
        return;
      }
      if (action === "start-dev") return openRunDialog(projectId);
      if (action === "stop-dev") return stopRun(projectId);
      if (action === "open-dev-server") return openServer(projectId);
      if (action === "rename") {
        setRenameProjectId(projectId);
        return;
      }
      if (action === "toggle-pin") return togglePinned(projectId);
      if (action === "archive-threads") return archiveAllThreads(projectId);
      if (action === "delete-threads") return deleteAllThreads(projectId);
      if (action !== "delete") return;

      const projectThreads = sidebarThreads.filter((thread) => thread.projectId === projectId);
      const confirmed = await api.dialogs.confirm(
        projectThreads.length > 0
          ? [
              `Remove project "${project.name}"?`,
              `This will delete ${projectThreads.length} ${pluralize(projectThreads.length, "thread")} in this folder and remove the project.`,
            ].join("\n")
          : `Remove project "${project.name}"?`,
      );
      if (!confirmed) return;

      try {
        const result = await deleteProjectThreads(projectId, {
          confirmMessage: null,
          showEmptyToast: false,
          showResultToast: false,
          worktreeCleanupMode: "skip",
        });
        if (!result) return;
        if (result.failureCount > 0) {
          toastManager.add({
            type: "error",
            title: `Failed to remove "${project.name}"`,
            description: `Could not delete ${result.failureCount} ${pluralize(result.failureCount, "thread")} in "${project.name}".`,
          });
          return;
        }
        await deleteProjectFromClient({
          api: api.orchestration,
          projectId,
          removeDeletedProjectFromClientState,
        });
        clearProjectDraftThreads(projectId);
        toastManager.add({
          type: "success",
          title: `Removed "${project.name}"`,
          description:
            result.deletedCount > 0
              ? `Deleted ${result.deletedCount} ${pluralize(result.deletedCount, "thread")} and removed the project.`
              : "Project removed.",
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Unknown error removing project.";
        console.error("Failed to remove project", { projectId, error: cause });
        toastManager.add({
          type: "error",
          title: `Failed to remove "${project.name}"`,
          description: message,
        });
      }
    },
    [
      archiveAllThreads,
      clearProjectDraftThreads,
      copyPath,
      deleteAllThreads,
      deleteProjectThreads,
      navigate,
      openRunDialog,
      openServer,
      projectById,
      removeDeletedProjectFromClientState,
      sidebarThreads,
      stopRun,
      togglePinned,
    ],
  );

  const openContextMenu = useCallback(
    (projectId: ProjectId, position: { x: number; y: number }) => {
      if (readNativeApi() && projectById.has(projectId)) setContextMenu({ projectId, position });
    },
    [projectById],
  );
  const saveRename = useCallback(
    (projectId: ProjectId, nextName: string, previousLocalName: string | null) => {
      const trimmed = nextName.trim();
      if (trimmed === (previousLocalName?.trim() ?? "")) return;
      renameProjectLocally(projectId, trimmed.length > 0 ? trimmed : null);
    },
    [renameProjectLocally],
  );

  const contextProject = contextMenu ? (projectById.get(contextMenu.projectId) ?? null) : null;
  const contextThreads = contextMenu
    ? sidebarThreads.filter((thread) => thread.projectId === contextMenu.projectId)
    : [];
  return {
    model: {
      contextMenu,
      contextProject,
      contextAnchor: contextMenu ? createClientPointMenuAnchor(contextMenu.position) : null,
      hasAnyThreads: contextThreads.length > 0,
      hasArchivableThreads: contextThreads.some((thread) => thread.archivedAt == null),
      isPinned: contextProject ? pinnedProjectIds.has(contextProject.id) : false,
      isRunning: contextProject ? Boolean(projectRunsByProjectId[contextProject.id]) : false,
      hasOpenServer: contextProject ? canOpenServer(contextProject.id) : false,
      renameProject: renameProjectId ? (projectById.get(renameProjectId) ?? null) : null,
    },
    actions: {
      openContextMenu,
      closeContextMenu: () => setContextMenu(null),
      runAction,
      closeRename: () => setRenameProjectId(null),
      saveRename,
    },
  };
}

export type SidebarProjectMenuOwner = ReturnType<typeof useSidebarProjectMenuOwner>;
