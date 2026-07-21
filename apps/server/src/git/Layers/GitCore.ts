// FILE: GitCore.ts
// Purpose: Assembles the low-level Git service from focused operation owners.
// Layer: Server Git service
// Exports: GitCoreLive plus makeGitCore test factory.
import { Effect, FileSystem, Layer, Path } from "effect";

import { GitCore, type GitCoreShape } from "../Services/GitCore.ts";
import { ServerConfig } from "../../config.ts";
import { makeGitBranchListing } from "./git-core/gitBranchListing.ts";
import { makeGitBranchWorktreeOperations } from "./git-core/gitBranchWorktreeOperations.ts";
import { makeGitExecution } from "./git-core/gitCommandExecution.ts";
import { makeGitPatchOperations } from "./git-core/gitPatchOperations.ts";
import { makeGitRepositoryRefs } from "./git-core/gitRepositoryRefs.ts";
import { makeGitStatusOperations } from "./git-core/gitStatusOperations.ts";
import { makeGitSyncOperations } from "./git-core/gitSyncOperations.ts";
import { makeGitWorkspaceOperations } from "./git-core/gitWorkspaceOperations.ts";

export const makeGitCore = (options?: { executeOverride?: GitCoreShape["execute"] }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { worktreesDir } = yield* ServerConfig;
    const execution = yield* makeGitExecution(options, fileSystem, path);
    const context = { ...execution, fileSystem, path, worktreesDir };
    const refs = yield* makeGitRepositoryRefs(context);
    const status = makeGitStatusOperations(context, refs);
    const patches = makeGitPatchOperations(context, refs, status);
    const sync = makeGitSyncOperations(context, refs, status);
    const branchListing = makeGitBranchListing(context);
    const branchWorktrees = makeGitBranchWorktreeOperations(context, refs);
    const workspace = makeGitWorkspaceOperations(context, branchWorktrees.checkoutBranch);

    return {
      execute: execution.execute,
      status: status.status,
      statusDetails: status.statusDetails,
      readWorkingTreePatch: patches.readWorkingTreePatch,
      readUnstagedPatch: patches.readUnstagedPatch,
      readStagedPatch: patches.readStagedPatch,
      readBranchPatch: patches.readBranchPatch,
      prepareCommitContext: patches.prepareCommitContext,
      commit: patches.commit,
      pushCurrentBranch: sync.pushCurrentBranch,
      pullCurrentBranch: sync.pullCurrentBranch,
      readRangeContext: patches.readRangeContext,
      readConfigValue: patches.readConfigValue,
      listBranches: branchListing.listBranches,
      createWorktree: branchWorktrees.createWorktree,
      createDetachedWorktree: branchWorktrees.createDetachedWorktree,
      fetchPullRequestBranch: branchWorktrees.fetchPullRequestBranch,
      ensureRemote: refs.ensureRemote,
      fetchRemoteBranch: branchWorktrees.fetchRemoteBranch,
      setBranchUpstream: branchWorktrees.setBranchUpstream,
      removeWorktree: branchWorktrees.removeWorktree,
      deleteBranch: branchWorktrees.deleteBranch,
      renameBranch: branchWorktrees.renameBranch,
      createBranch: branchWorktrees.createBranch,
      publishBranch: branchWorktrees.publishBranch,
      checkoutBranch: branchWorktrees.checkoutBranch,
      stashAndCheckout: workspace.stashAndCheckout,
      stashDrop: workspace.stashDrop,
      stashInfo: workspace.stashInfo,
      removeIndexLock: workspace.removeIndexLock,
      initRepo: workspace.initRepo,
      listLocalBranchNames: workspace.listLocalBranchNames,
      stageFiles: workspace.stageFiles,
      unstageFiles: workspace.unstageFiles,
    } satisfies GitCoreShape;
  });

export const GitCoreLive = Layer.effect(GitCore, makeGitCore());
