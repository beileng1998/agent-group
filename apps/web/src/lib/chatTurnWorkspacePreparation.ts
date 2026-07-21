// FILE: chatTurnWorkspacePreparation.ts
// Purpose: Create and bind a first-send worktree before a chat turn starts.
// Layer: Web send orchestration

import { type NativeApi, type ThreadId } from "@agent-group/contracts";
import { buildTemporaryWorktreeBranchName } from "@agent-group/shared/git";
import { deriveAssociatedWorktreeMetadata } from "@agent-group/shared/threadWorkspace";

import { newCommandId } from "./utils";

export interface PreparedChatTurnWorkspace {
  readonly branch: string | null;
  readonly worktreePath: string | null;
}

export async function prepareChatTurnWorkspace(input: {
  api: NativeApi;
  threadId: ThreadId;
  isServerThread: boolean;
  targetProjectCwd: string;
  baseBranchForWorktree: string | null;
  initialBranch: string | null;
  initialWorktreePath: string | null;
  createWorktree: (request: {
    cwd: string;
    branch: string;
    newBranch: string;
  }) => Promise<{ worktree: { branch: string; path: string } }>;
  onPreparingThread: () => void;
  onServerWorkspaceReady: (workspace: {
    branch: string;
    worktreePath: string;
    associatedWorktreePath: string | null;
    associatedWorktreeBranch: string | null;
    associatedWorktreeRef: string | null;
  }) => void;
}): Promise<PreparedChatTurnWorkspace> {
  if (!input.baseBranchForWorktree) {
    return {
      branch: input.initialBranch,
      worktreePath: input.initialWorktreePath,
    };
  }

  const result = await input.createWorktree({
    cwd: input.targetProjectCwd,
    branch: input.baseBranchForWorktree,
    newBranch: buildTemporaryWorktreeBranchName(),
  });
  input.onPreparingThread();

  const associatedWorktree = deriveAssociatedWorktreeMetadata({
    branch: result.worktree.branch,
    worktreePath: result.worktree.path,
  });
  if (input.isServerThread) {
    await input.api.orchestration.dispatchCommand({
      type: "thread.meta.update",
      commandId: newCommandId(),
      threadId: input.threadId,
      envMode: "worktree",
      branch: result.worktree.branch,
      worktreePath: result.worktree.path,
      associatedWorktreePath: associatedWorktree.associatedWorktreePath,
      associatedWorktreeBranch: associatedWorktree.associatedWorktreeBranch,
      associatedWorktreeRef: associatedWorktree.associatedWorktreeRef,
    });
    input.onServerWorkspaceReady({
      branch: result.worktree.branch,
      worktreePath: result.worktree.path,
      ...associatedWorktree,
    });
  }

  return {
    branch: result.worktree.branch,
    worktreePath: result.worktree.path,
  };
}
