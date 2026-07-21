// FILE: chatFirstSendPreparation.ts
// Purpose: Resolve first-send project ownership and worktree setup without touching UI state.
// Layer: Web send orchestration

import {
  type NativeApi,
  type OrchestrationShellSnapshot,
  type ProjectScript,
  type ThreadEnvironmentMode,
} from "@agent-group/contracts";

import type { Project } from "../types";
import { setupProjectScript } from "../projectScripts";
import { newCommandId, newProjectId } from "./utils";
import type { FirstSendProjectTarget, FirstSendTargetResolution } from "./chatFirstSend";
import {
  isDuplicateProjectCreateError,
  waitForRecoverableProjectForDuplicateCreate,
} from "./projectCreateRecovery";

export type PreparedFirstSendTarget = FirstSendProjectTarget & {
  readonly nextThreadEnvMode: ThreadEnvironmentMode;
  readonly nextThreadBranch: string | null;
  readonly nextThreadWorktreePath: string | null;
  readonly baseBranchForWorktree: string | null;
  readonly setupScriptForWorktree: ProjectScript | null;
  readonly shellSnapshotToSync: OrchestrationShellSnapshot | null;
  readonly shouldReassociateDraft: boolean;
};

export type FirstSendPreparationResult =
  | { readonly kind: "blocked"; readonly error: string }
  | { readonly kind: "ready"; readonly target: PreparedFirstSendTarget };

function activeProjectFallbackTarget(project: Project): FirstSendProjectTarget {
  return {
    targetProjectId: project.id,
    targetProjectKind: project.kind,
    targetProjectCwd: project.cwd,
    targetProjectScripts: project.kind === "project" ? project.scripts : [],
    targetProjectDefaultModelSelection: project.defaultModelSelection ?? null,
  };
}

export async function prepareFirstSendTarget(input: {
  api: NativeApi;
  activeProject: Project;
  firstSendTarget: FirstSendTargetResolution;
  firstSendCreatedAt: Date;
  isFirstMessage: boolean;
  isContainerLandingProject: boolean;
  activeRootBranch: string | null;
  initialEnvMode: ThreadEnvironmentMode;
  initialBranch: string | null;
  initialWorktreePath: string | null;
}): Promise<FirstSendPreparationResult> {
  let target =
    input.firstSendTarget.kind === "create-project"
      ? activeProjectFallbackTarget(input.activeProject)
      : input.firstSendTarget.target;
  let shellSnapshotToSync: OrchestrationShellSnapshot | null = null;
  let shouldReassociateDraft = false;
  let nextThreadEnvMode = input.initialEnvMode;
  let nextThreadBranch = input.initialBranch;
  let nextThreadWorktreePath = input.initialWorktreePath;

  if (
    input.isFirstMessage &&
    input.isContainerLandingProject &&
    input.firstSendTarget.kind !== "current"
  ) {
    if (input.firstSendTarget.kind === "create-project") {
      const projectId = newProjectId();
      const createdAt = input.firstSendCreatedAt.toISOString();
      try {
        await input.api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          kind: input.firstSendTarget.creation.kind,
          title: input.firstSendTarget.creation.title,
          workspaceRoot: input.firstSendTarget.creation.workspaceRoot,
          createWorkspaceRootIfMissing: input.firstSendTarget.creation.createWorkspaceRootIfMissing,
          defaultModelSelection: input.firstSendTarget.creation.defaultModelSelection,
          createdAt,
        });
        target = {
          targetProjectId: projectId,
          targetProjectKind: input.firstSendTarget.creation.kind,
          targetProjectCwd: input.firstSendTarget.creation.workspaceRoot,
          targetProjectScripts: [],
          targetProjectDefaultModelSelection: input.firstSendTarget.creation.defaultModelSelection,
        };
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "Failed to create the selected project.";
        if (!isDuplicateProjectCreateError(description)) {
          throw error;
        }
        const recovery = await waitForRecoverableProjectForDuplicateCreate({
          message: description,
          workspaceRoot: input.firstSendTarget.creation.workspaceRoot,
          loadSnapshot: () => input.api.orchestration.getShellSnapshot().catch(() => null),
        });
        if (!recovery.snapshot || !recovery.project) {
          throw error;
        }
        shellSnapshotToSync = recovery.snapshot;
        const recoveredKind = recovery.project.kind ?? input.firstSendTarget.creation.kind;
        target = {
          targetProjectId: recovery.project.id,
          targetProjectKind: recoveredKind,
          targetProjectCwd: recovery.project.workspaceRoot,
          targetProjectScripts: recoveredKind === "project" ? [...recovery.project.scripts] : [],
          targetProjectDefaultModelSelection:
            recovery.project.defaultModelSelection ??
            input.firstSendTarget.creation.defaultModelSelection,
        };
      }
    }

    shouldReassociateDraft = true;
    nextThreadEnvMode = "local";
    nextThreadBranch = null;
    nextThreadWorktreePath = null;
  }

  if (
    input.isFirstMessage &&
    nextThreadEnvMode === "worktree" &&
    !nextThreadWorktreePath &&
    !nextThreadBranch
  ) {
    nextThreadBranch = input.activeRootBranch;
  }

  const baseBranchForWorktree =
    input.isFirstMessage && nextThreadEnvMode === "worktree" && !nextThreadWorktreePath
      ? nextThreadBranch
      : null;
  const shouldCreateWorktree =
    input.isFirstMessage && nextThreadEnvMode === "worktree" && !nextThreadWorktreePath;
  if (shouldCreateWorktree && !nextThreadBranch) {
    return {
      kind: "blocked",
      error: "Select a base branch before sending in New worktree mode.",
    };
  }

  return {
    kind: "ready",
    target: {
      ...target,
      nextThreadEnvMode,
      nextThreadBranch,
      nextThreadWorktreePath,
      baseBranchForWorktree,
      setupScriptForWorktree: baseBranchForWorktree
        ? setupProjectScript(target.targetProjectScripts)
        : null,
      shellSnapshotToSync,
      shouldReassociateDraft,
    },
  };
}
