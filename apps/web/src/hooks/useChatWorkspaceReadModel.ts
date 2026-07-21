// FILE: useChatWorkspaceReadModel.ts
// Purpose: Derive the active project, environment, worktree, and Git workspace model.
// Layer: Web chat read model

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  resolveThreadBranchSourceCwd,
  resolveThreadWorkspaceCwd,
  resolveThreadWorkspaceState,
} from "@agent-group/shared/threadEnvironment";
import { deriveAssociatedWorktreeMetadata } from "@agent-group/shared/threadWorkspace";

import { isHomeChatContainerProject } from "../lib/chatProjects";
import {
  resolveDiffEnvironmentState,
  resolveThreadEnvironmentMode,
} from "../lib/threadEnvironment";
import { isStudioContainerProject } from "../lib/studioProjects";
import { gitBranchesQueryOptions } from "../lib/gitReactQuery";
import { projectScriptRuntimeEnv } from "../projectScripts";
import { resolveComposerSlashRootBranch } from "../composerSlashCommands";
import type { DraftThreadState } from "../composerDraftStore";
import { useStore } from "../store";
import { createProjectSelector } from "../storeSelectors";
import type { Thread } from "../types";
import { useWorkspaceStore } from "../workspaceStore";

export function useChatWorkspaceReadModel(input: {
  thread: Thread | undefined;
  draftThread: DraftThreadState | null;
  isServerThread: boolean;
}) {
  const activeProjectId = input.thread?.projectId ?? input.draftThread?.projectId ?? null;
  const activeProject = useStore(
    useMemo(() => createProjectSelector(activeProjectId), [activeProjectId]),
  );
  const homeDir = useWorkspaceStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspaceStore((state) => state.chatWorkspaceRoot);
  const studioWorkspaceRoot = useWorkspaceStore((state) => state.studioWorkspaceRoot);
  const isHomeChatContainer = isHomeChatContainerProject(activeProject, {
    homeDir,
    chatWorkspaceRoot,
  });
  const isStudioContainer = isStudioContainerProject(activeProject, {
    homeDir,
    chatWorkspaceRoot,
    studioWorkspaceRoot,
  });
  const isContainerLandingProject = isHomeChatContainer || isStudioContainer;

  const resolvedThreadEnvMode = input.isServerThread
    ? (input.thread?.envMode ?? null)
    : (input.draftThread?.envMode ?? null);
  const resolvedThreadWorktreePath = input.isServerThread
    ? (input.thread?.worktreePath ?? null)
    : (input.draftThread?.worktreePath ?? null);
  const diffEnvironment = resolveDiffEnvironmentState({
    projectCwd: activeProject?.cwd ?? null,
    envMode: resolvedThreadEnvMode,
    worktreePath: resolvedThreadWorktreePath,
  });
  const associatedWorktree = useMemo(
    () =>
      deriveAssociatedWorktreeMetadata({
        branch: input.thread?.branch ?? null,
        worktreePath: input.thread?.worktreePath ?? null,
        ...(input.thread?.associatedWorktreePath !== undefined
          ? { associatedWorktreePath: input.thread.associatedWorktreePath }
          : {}),
        ...(input.thread?.associatedWorktreeBranch !== undefined
          ? { associatedWorktreeBranch: input.thread.associatedWorktreeBranch }
          : {}),
        ...(input.thread?.associatedWorktreeRef !== undefined
          ? { associatedWorktreeRef: input.thread.associatedWorktreeRef }
          : {}),
      }),
    [
      input.thread?.associatedWorktreeBranch,
      input.thread?.associatedWorktreePath,
      input.thread?.associatedWorktreeRef,
      input.thread?.branch,
      input.thread?.worktreePath,
    ],
  );
  const workspaceCwd = activeProject
    ? resolveThreadWorkspaceCwd({
        projectCwd: activeProject.cwd,
        envMode: resolvedThreadEnvMode,
        worktreePath: resolvedThreadWorktreePath,
      })
    : null;
  const branchSourceCwd = activeProject
    ? resolveThreadBranchSourceCwd({
        projectCwd: activeProject.cwd,
        worktreePath: resolvedThreadWorktreePath,
      })
    : null;
  const branchesQuery = useQuery(gitBranchesQueryOptions(branchSourceCwd));
  const activeRootBranch = useMemo(
    () =>
      resolveComposerSlashRootBranch({
        branches: branchesQuery.data?.branches,
        activeProjectCwd: activeProject?.cwd,
        activeThreadBranch: input.thread?.branch,
      }),
    [activeProject?.cwd, branchesQuery.data?.branches, input.thread?.branch],
  );
  const terminalRuntimeEnv = useMemo(
    () =>
      activeProject
        ? projectScriptRuntimeEnv({
            project: { cwd: activeProject.cwd },
            worktreePath: input.thread?.worktreePath ?? null,
          })
        : {},
    [activeProject, input.thread?.worktreePath],
  );
  const envMode = input.isServerThread
    ? resolveThreadEnvironmentMode({
        envMode: input.thread?.envMode,
        worktreePath: input.thread?.worktreePath ?? null,
      })
    : (input.draftThread?.envMode ?? "local");

  return {
    project: {
      id: activeProjectId,
      value: activeProject,
      homeDir,
      chatWorkspaceRoot,
      displayName: isHomeChatContainer ? activeProject?.folderName : activeProject?.name,
    },
    container: {
      isHome: isHomeChatContainer,
      isStudio: isStudioContainer,
      isLanding: isContainerLandingProject,
    },
    environment: {
      mode: envMode,
      state: resolveThreadWorkspaceState({
        envMode: resolvedThreadEnvMode,
        worktreePath: resolvedThreadWorktreePath,
      }),
      resolvedMode: resolvedThreadEnvMode,
      worktreePath: resolvedThreadWorktreePath,
      diffPending: diffEnvironment.pending,
      diffDisabledReason: diffEnvironment.disabledReason,
      associatedWorktree,
    },
    git: {
      cwd: workspaceCwd,
      branchSourceCwd,
      activeRootBranch,
      isRepo: branchesQuery.data?.isRepo ?? true,
      showActions: !isContainerLandingProject || Boolean(resolvedThreadWorktreePath),
    },
    terminalRuntimeEnv,
  };
}
