import { Effect } from "effect";
import { randomUUID } from "node:crypto";

import { GitCheckoutDirtyWorktreeError } from "../../Errors.ts";
import type { GitCoreShape } from "../../Services/GitCore.ts";
import type { GitOperationContext } from "./gitCoreTypes.ts";
import type { GitRepositoryRefs } from "./gitRepositoryRefs.ts";
import {
  AUTO_DETACHED_WORKTREE_DIRNAME,
  commandLabel,
  createGitCommandError,
  deriveLocalBranchNameFromRemoteRef,
  parseDirtyWorktreeFiles,
  parseTrackingBranchByUpstreamRef,
} from "./gitCoreValues.ts";

export function makeGitBranchWorktreeOperations(
  context: GitOperationContext,
  refs: GitRepositoryRefs,
) {
  const { executeGit, fileSystem, path, runGit, worktreesDir } = context;
  const buildGeneratedDetachedWorktreePath = (cwd: string) =>
    Effect.gen(function* () {
      void cwd;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const shortId = randomUUID().replace(/-/g, "").slice(0, 4);
        const candidateParent = path.join(worktreesDir, shortId);
        const candidatePath = path.join(candidateParent, AUTO_DETACHED_WORKTREE_DIRNAME);
        if (yield* fileSystem.exists(candidatePath)) continue;
        yield* fileSystem.makeDirectory(candidateParent, { recursive: true });
        return candidatePath;
      }
      const fallbackId = randomUUID().replace(/-/g, "");
      const fallbackParent = path.join(worktreesDir, fallbackId);
      yield* fileSystem.makeDirectory(fallbackParent, { recursive: true });
      return path.join(fallbackParent, AUTO_DETACHED_WORKTREE_DIRNAME);
    });

  const createWorktree: GitCoreShape["createWorktree"] = (input) =>
    Effect.gen(function* () {
      const targetBranch = input.newBranch ?? input.branch;
      const sanitizedBranch = targetBranch.replace(/\//g, "-");
      const repoName = path.basename(input.cwd);
      const worktreePath = input.path ?? path.join(worktreesDir, repoName, sanitizedBranch);
      const args = input.newBranch
        ? ["worktree", "add", "-b", input.newBranch, worktreePath, input.branch]
        : ["worktree", "add", worktreePath, input.branch];
      yield* executeGit("GitCore.createWorktree", input.cwd, args, {
        fallbackErrorMessage: "git worktree add failed",
      });
      return { worktree: { path: worktreePath, branch: targetBranch } };
    });

  const createDetachedWorktree: GitCoreShape["createDetachedWorktree"] = (input) =>
    Effect.gen(function* () {
      const worktreePath =
        input.path ??
        (yield* buildGeneratedDetachedWorktreePath(input.cwd).pipe(
          Effect.mapError((cause: unknown) =>
            createGitCommandError(
              "GitCore.createDetachedWorktree",
              input.cwd,
              ["worktree", "add", "--detach", "<generated>", input.ref],
              "failed to prepare detached worktree path.",
              cause,
            ),
          ),
        ));
      yield* executeGit("GitCore.createDetachedWorktree", input.cwd, [
        "worktree",
        "add",
        "--detach",
        worktreePath,
        input.ref,
      ]);
      return { worktree: { path: worktreePath, ref: input.ref, branch: null } };
    });

  const fetchPullRequestBranch: GitCoreShape["fetchPullRequestBranch"] = (input) =>
    Effect.gen(function* () {
      const remoteName = yield* refs.resolvePrimaryRemoteName(input.cwd);
      yield* executeGit(
        "GitCore.fetchPullRequestBranch",
        input.cwd,
        [
          "fetch",
          "--quiet",
          "--no-tags",
          remoteName,
          `+refs/pull/${input.prNumber}/head:refs/heads/${input.branch}`,
        ],
        { fallbackErrorMessage: "git fetch pull request branch failed" },
      );
    }).pipe(Effect.asVoid);

  const fetchRemoteBranch: GitCoreShape["fetchRemoteBranch"] = (input) =>
    Effect.gen(function* () {
      yield* runGit("GitCore.fetchRemoteBranch.fetch", input.cwd, [
        "fetch",
        "--quiet",
        "--no-tags",
        input.remoteName,
        `+refs/heads/${input.remoteBranch}:refs/remotes/${input.remoteName}/${input.remoteBranch}`,
      ]);
      const localBranchAlreadyExists = yield* refs.branchExists(input.cwd, input.localBranch);
      const targetRef = `${input.remoteName}/${input.remoteBranch}`;
      yield* runGit(
        "GitCore.fetchRemoteBranch.materialize",
        input.cwd,
        localBranchAlreadyExists
          ? ["branch", "--force", input.localBranch, targetRef]
          : ["branch", input.localBranch, targetRef],
      );
    }).pipe(Effect.asVoid);

  const setBranchUpstream: GitCoreShape["setBranchUpstream"] = (input) =>
    runGit("GitCore.setBranchUpstream", input.cwd, [
      "branch",
      "--set-upstream-to",
      `${input.remoteName}/${input.remoteBranch}`,
      input.branch,
    ]);

  const removeWorktree: GitCoreShape["removeWorktree"] = (input) =>
    Effect.gen(function* () {
      const args = ["worktree", "remove"];
      if (input.force) args.push("--force");
      args.push(input.path);
      yield* executeGit("GitCore.removeWorktree", input.cwd, args, {
        timeoutMs: 15_000,
        fallbackErrorMessage: "git worktree remove failed",
      }).pipe(
        Effect.mapError((error) =>
          createGitCommandError(
            "GitCore.removeWorktree",
            input.cwd,
            args,
            `${commandLabel(args)} failed (cwd: ${input.cwd}): ${error instanceof Error ? error.message : String(error)}`,
            error,
          ),
        ),
      );
    });

  const deleteBranch: GitCoreShape["deleteBranch"] = (input) =>
    Effect.gen(function* () {
      const args = ["branch", input.force ? "-D" : "-d", "--", input.branch];
      yield* executeGit("GitCore.deleteBranch", input.cwd, args, {
        timeoutMs: 10_000,
        fallbackErrorMessage: "git branch delete failed",
      }).pipe(
        Effect.mapError((error) =>
          createGitCommandError(
            "GitCore.deleteBranch",
            input.cwd,
            args,
            `${commandLabel(args)} failed (cwd: ${input.cwd}): ${error instanceof Error ? error.message : String(error)}`,
            error,
          ),
        ),
      );
    });

  const renameBranch: GitCoreShape["renameBranch"] = (input) =>
    Effect.gen(function* () {
      if (input.oldBranch === input.newBranch) return { branch: input.newBranch };
      const targetBranch = yield* refs.resolveAvailableBranchName(input.cwd, input.newBranch);
      yield* executeGit(
        "GitCore.renameBranch",
        input.cwd,
        ["branch", "-m", "--", input.oldBranch, targetBranch],
        { timeoutMs: 10_000, fallbackErrorMessage: "git branch rename failed" },
      );
      return { branch: targetBranch };
    });

  const publishBranch: GitCoreShape["publishBranch"] = (input) =>
    Effect.gen(function* () {
      const remoteName = yield* refs.resolvePushRemoteName(input.cwd, input.branch);
      if (!remoteName) {
        return yield* createGitCommandError(
          "GitCore.publishBranch",
          input.cwd,
          ["push", "-u", "<remote>", input.branch],
          "Cannot publish branch because no git remote is configured for this repository.",
        );
      }
      yield* executeGit(
        "GitCore.publishBranch",
        input.cwd,
        ["push", "-u", remoteName, input.branch],
        { timeoutMs: 30_000, fallbackErrorMessage: "git branch publish failed" },
      );
    }).pipe(Effect.asVoid);

  const createBranch: GitCoreShape["createBranch"] = (input) =>
    Effect.gen(function* () {
      yield* executeGit("GitCore.createBranch", input.cwd, ["branch", input.branch], {
        timeoutMs: 10_000,
        fallbackErrorMessage: "git branch create failed",
      });
      if (input.publish === true) yield* publishBranch({ cwd: input.cwd, branch: input.branch });
    }).pipe(Effect.asVoid);

  const resolveCheckoutBranchArgs = (input: { cwd: string; branch: string }) =>
    Effect.gen(function* () {
      const [localInputExists, remoteExists] = yield* Effect.all(
        [
          executeGit(
            "GitCore.checkoutBranch.localInputExists",
            input.cwd,
            ["show-ref", "--verify", "--quiet", `refs/heads/${input.branch}`],
            { timeoutMs: 5_000, allowNonZeroExit: true },
          ).pipe(Effect.map((result) => result.code === 0)),
          executeGit(
            "GitCore.checkoutBranch.remoteExists",
            input.cwd,
            ["show-ref", "--verify", "--quiet", `refs/remotes/${input.branch}`],
            { timeoutMs: 5_000, allowNonZeroExit: true },
          ).pipe(Effect.map((result) => result.code === 0)),
        ],
        { concurrency: "unbounded" },
      );
      const localTrackingBranch = remoteExists
        ? yield* executeGit(
            "GitCore.checkoutBranch.localTrackingBranch",
            input.cwd,
            ["for-each-ref", "--format=%(refname:short)\t%(upstream:short)", "refs/heads"],
            { timeoutMs: 5_000, allowNonZeroExit: true },
          ).pipe(
            Effect.map((result) =>
              result.code === 0
                ? parseTrackingBranchByUpstreamRef(result.stdout, input.branch)
                : null,
            ),
          )
        : null;
      const localTrackedBranchCandidate = deriveLocalBranchNameFromRemoteRef(input.branch);
      const localTrackedBranchTargetExists =
        remoteExists && localTrackedBranchCandidate
          ? yield* executeGit(
              "GitCore.checkoutBranch.localTrackedBranchTargetExists",
              input.cwd,
              ["show-ref", "--verify", "--quiet", `refs/heads/${localTrackedBranchCandidate}`],
              { timeoutMs: 5_000, allowNonZeroExit: true },
            ).pipe(Effect.map((result) => result.code === 0))
          : false;
      return localInputExists
        ? ["checkout", input.branch]
        : remoteExists && !localTrackingBranch && localTrackedBranchTargetExists
          ? ["checkout", input.branch]
          : remoteExists && !localTrackingBranch
            ? ["checkout", "--track", input.branch]
            : remoteExists && localTrackingBranch
              ? ["checkout", localTrackingBranch]
              : ["checkout", input.branch];
    });

  const checkoutBranch: GitCoreShape["checkoutBranch"] = (input) =>
    Effect.gen(function* () {
      const checkoutArgs = yield* resolveCheckoutBranchArgs(input);
      const result = yield* executeGit("GitCore.checkoutBranch.checkout", input.cwd, checkoutArgs, {
        timeoutMs: 10_000,
        allowNonZeroExit: true,
        fallbackErrorMessage: "git checkout failed",
      });
      if (result.code !== 0) {
        const conflictingFiles = parseDirtyWorktreeFiles(result.stderr);
        if (conflictingFiles) {
          return yield* new GitCheckoutDirtyWorktreeError({
            branch: input.branch,
            cwd: input.cwd,
            conflictingFiles,
          });
        }
        const stderr = result.stderr.trim();
        return yield* createGitCommandError(
          "GitCore.checkoutBranch.checkout",
          input.cwd,
          checkoutArgs,
          stderr.length > 0 ? stderr : "git checkout failed",
        );
      }
      yield* Effect.forkScoped(
        refs.refreshCheckedOutBranchUpstream(input.cwd).pipe(Effect.ignoreCause({ log: true })),
      );
    });

  return {
    createWorktree,
    createDetachedWorktree,
    fetchPullRequestBranch,
    fetchRemoteBranch,
    setBranchUpstream,
    removeWorktree,
    deleteBranch,
    renameBranch,
    createBranch,
    publishBranch,
    checkoutBranch,
  };
}
