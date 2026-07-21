// FILE: useWorkspaceSelectionController.ts
// Purpose: Own empty-draft project selection and thread workspace mode changes.
// Layer: Web workspace selection controller

import {
  type OrchestrationShellSnapshot,
  type ProjectId,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback } from "react";
import { workspaceRootsEqual } from "@agent-group/shared/threadWorkspace";

import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { ensureHomeChatProject } from "../lib/chatProjects";
import {
  createOrRecoverProjectFromPath,
  PROJECT_CREATE_EXISTING_SYNC_ERROR,
  PROJECT_CREATE_SYNC_ERROR,
} from "../lib/projectCreation";
import { ensureStudioProject } from "../lib/studioProjects";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { useWorkspaceStore } from "../workspaceStore";
import {
  LOCAL_PROJECT_DRAFT_CONTEXT,
  waitForShellProjectById,
} from "../components/chat/chatViewDraftPersistence";
import type { Thread } from "../types";

interface UseWorkspaceSelectionControllerOptions {
  activeRootBranch: string | null;
  activeThread: Thread | null | undefined;
  draftThread: DraftThreadState | null;
  hasNativeUserMessages: boolean;
  isHomeContainer: boolean;
  isLocalDraftThread: boolean;
  isServerThread: boolean;
  isStudioContainer: boolean;
  scheduleComposerFocus: () => void;
  syncServerShellSnapshot: (snapshot: OrchestrationShellSnapshot) => void;
  threadId: ThreadId;
}

export function useWorkspaceSelectionController(options: UseWorkspaceSelectionControllerOptions) {
  const {
    activeRootBranch,
    activeThread,
    draftThread,
    hasNativeUserMessages,
    isHomeContainer,
    isLocalDraftThread,
    isServerThread,
    isStudioContainer,
    scheduleComposerFocus,
    syncServerShellSnapshot,
    threadId,
  } = options;
  const setDraftThreadContext = useComposerDraftStore((state) => state.setDraftThreadContext);
  const moveDraftThreadToProject = useComposerDraftStore((state) => state.moveDraftThreadToProject);
  const setThreadWorkspace = useStore((state) => state.setThreadWorkspace);
  const homeDir = useWorkspaceStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspaceStore((state) => state.chatWorkspaceRoot);
  const studioWorkspaceRoot = useWorkspaceStore((state) => state.studioWorkspaceRoot);

  const moveEmptyDraftToLocalProject = useCallback(
    (projectId: ProjectId) => {
      moveDraftThreadToProject(threadId, projectId, LOCAL_PROJECT_DRAFT_CONTEXT);
      scheduleComposerFocus();
    },
    [moveDraftThreadToProject, scheduleComposerFocus, threadId],
  );

  const onEnvModeChange = useCallback(
    (mode: DraftThreadEnvMode) => {
      const nextBranch =
        mode === "worktree"
          ? (activeThread?.branch ?? draftThread?.branch ?? activeRootBranch ?? null)
          : (activeThread?.branch ?? draftThread?.branch ?? null);
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, {
          envMode: mode,
          ...(mode === "local" ? { worktreePath: null } : {}),
          ...(nextBranch ? { branch: nextBranch } : {}),
        });
      }
      if (isServerThread && activeThread && !hasNativeUserMessages && !activeThread.session) {
        const api = readNativeApi();
        if (api) {
          void api.orchestration.dispatchCommand({
            type: "thread.meta.update",
            commandId: newCommandId(),
            threadId,
            envMode: mode,
            ...(nextBranch ? { branch: nextBranch } : {}),
            ...(mode === "local" ? { worktreePath: null } : {}),
          });
        }
      }
      scheduleComposerFocus();
    },
    [
      activeRootBranch,
      activeThread,
      draftThread?.branch,
      hasNativeUserMessages,
      isLocalDraftThread,
      isServerThread,
      scheduleComposerFocus,
      setDraftThreadContext,
      threadId,
    ],
  );

  const resetWorkspaceToHome = useCallback(() => {
    if (isLocalDraftThread) {
      if (isStudioContainer) {
        return (async () => {
          const studioProjectId = await ensureStudioProject({
            homeDir,
            chatWorkspaceRoot,
            studioWorkspaceRoot,
          });
          if (!studioProjectId) throw new Error("Unable to prepare Studio.");
          const api = readNativeApi();
          if (!api) throw new Error("App is still connecting. Try again in a moment.");
          const projectLoaded = useStore
            .getState()
            .projects.some((project) => project.id === studioProjectId);
          if (!projectLoaded) {
            const { project, snapshot } = await waitForShellProjectById(api, studioProjectId);
            if (!project || !snapshot) throw new Error(PROJECT_CREATE_SYNC_ERROR);
            syncServerShellSnapshot(snapshot);
          }
          moveEmptyDraftToLocalProject(studioProjectId);
        })();
      }
      if (!isHomeContainer) {
        return (async () => {
          if (!homeDir) throw new Error("Home folder is not available yet.");
          const homeProjectId = await ensureHomeChatProject({ homeDir, chatWorkspaceRoot });
          if (!homeProjectId) throw new Error("Unable to prepare a normal chat.");
          const api = readNativeApi();
          if (!api) throw new Error("App is still connecting. Try again in a moment.");
          const projectLoaded = useStore
            .getState()
            .projects.some((project) => project.id === homeProjectId);
          if (!projectLoaded) {
            const { project, snapshot } = await waitForShellProjectById(api, homeProjectId);
            if (!project || !snapshot) throw new Error(PROJECT_CREATE_SYNC_ERROR);
            syncServerShellSnapshot(snapshot);
          }
          moveEmptyDraftToLocalProject(homeProjectId);
        })();
      }
      setDraftThreadContext(threadId, {
        envMode: "local",
        worktreePath: null,
        branch: null,
        lastKnownPr: null,
      });
      scheduleComposerFocus();
      return;
    }

    if (activeThread) {
      setThreadWorkspace(activeThread.id, { envMode: "local", worktreePath: null });
      const api = readNativeApi();
      if (api && !hasNativeUserMessages && !activeThread.session) {
        void api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThread.id,
          envMode: "local",
          worktreePath: null,
        });
      }
    }
    scheduleComposerFocus();
  }, [
    activeThread,
    chatWorkspaceRoot,
    hasNativeUserMessages,
    homeDir,
    isHomeContainer,
    isLocalDraftThread,
    isStudioContainer,
    moveEmptyDraftToLocalProject,
    scheduleComposerFocus,
    setDraftThreadContext,
    setThreadWorkspace,
    studioWorkspaceRoot,
    syncServerShellSnapshot,
    threadId,
  ]);

  const selectWorkspaceRoot = useCallback(
    (workspaceRoot: string) => {
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { envMode: "worktree", worktreePath: workspaceRoot });
        scheduleComposerFocus();
        return;
      }
      if (activeThread) {
        setThreadWorkspace(activeThread.id, {
          envMode: "worktree",
          worktreePath: workspaceRoot,
        });
      }
      scheduleComposerFocus();
    },
    [
      activeThread,
      isLocalDraftThread,
      scheduleComposerFocus,
      setDraftThreadContext,
      setThreadWorkspace,
      threadId,
    ],
  );

  const selectProjectForEmptyDraft = useCallback(
    (projectId: ProjectId) => {
      if (!isLocalDraftThread) return;
      const project = useStore
        .getState()
        .projects.find((candidate) => candidate.id === projectId && candidate.kind === "project");
      if (!project) throw new Error("Selected project is not available.");
      if (draftThread?.projectId === projectId) {
        scheduleComposerFocus();
        return;
      }
      moveEmptyDraftToLocalProject(projectId);
    },
    [
      draftThread?.projectId,
      isLocalDraftThread,
      moveEmptyDraftToLocalProject,
      scheduleComposerFocus,
    ],
  );

  const createProjectFromPickerPath = useCallback(
    async (workspaceRoot: string) => {
      if (!isLocalDraftThread) return;
      const api = readNativeApi();
      if (!api) throw new Error("App is still connecting. Try again in a moment.");

      const existingProject = useStore
        .getState()
        .projects.find(
          (project) =>
            project.kind === "project" && workspaceRootsEqual(project.cwd, workspaceRoot),
        );
      if (existingProject) {
        selectProjectForEmptyDraft(existingProject.id);
        return;
      }

      const creationResult = await createOrRecoverProjectFromPath({
        api,
        workspaceRoot,
        createIfMissing: false,
        loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
      });
      if (creationResult.snapshot) syncServerShellSnapshot(creationResult.snapshot);
      if (!creationResult.created && !creationResult.project) {
        throw new Error(PROJECT_CREATE_EXISTING_SYNC_ERROR);
      }
      if (!creationResult.project) throw new Error(PROJECT_CREATE_SYNC_ERROR);
      moveEmptyDraftToLocalProject(creationResult.project.id);
    },
    [
      isLocalDraftThread,
      moveEmptyDraftToLocalProject,
      selectProjectForEmptyDraft,
      syncServerShellSnapshot,
    ],
  );

  return {
    createProjectFromPickerPath,
    onEnvModeChange,
    resetWorkspaceToHome,
    selectProjectForEmptyDraft,
    selectWorkspaceRoot,
  };
}
