import { Effect } from "effect";

import type { GitCoreShape } from "../../Services/GitCore.ts";
import type { GitOperationContext } from "./gitCoreTypes.ts";
import type { GitRepositoryRefs } from "./gitRepositoryRefs.ts";
import type { GitStatusOperations } from "./gitStatusOperations.ts";
import { createGitCommandError, explainPullBlockedByLocalChanges } from "./gitCoreValues.ts";

export function makeGitSyncOperations(
  context: GitOperationContext,
  refs: GitRepositoryRefs,
  statusOperations: GitStatusOperations,
) {
  const { executeGit, runGit, runGitStdout } = context;
  const pushCurrentBranch: GitCoreShape["pushCurrentBranch"] = (cwd, fallbackBranch) =>
    Effect.gen(function* () {
      const details = yield* statusOperations.statusDetails(cwd);
      const branch = details.branch ?? fallbackBranch;
      if (!branch) {
        return yield* createGitCommandError(
          "GitCore.pushCurrentBranch",
          cwd,
          ["push"],
          "Cannot push from detached HEAD.",
        );
      }
      const hasNoLocalDelta = details.aheadCount === 0 && details.behindCount === 0;
      if (hasNoLocalDelta) {
        if (details.hasUpstream) {
          return {
            status: "skipped_up_to_date" as const,
            branch,
            ...(details.upstreamRef ? { upstreamBranch: details.upstreamRef } : {}),
          };
        }
        const comparableBaseBranch = yield* refs
          .resolveBaseBranchForNoUpstream(cwd, branch)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (comparableBaseBranch) {
          const publishRemoteName = yield* refs
            .resolvePushRemoteName(cwd, branch)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!publishRemoteName) return { status: "skipped_up_to_date" as const, branch };
          const hasRemoteBranch = yield* refs
            .remoteBranchExists(cwd, publishRemoteName, branch)
            .pipe(Effect.catch(() => Effect.succeed(false)));
          if (hasRemoteBranch) return { status: "skipped_up_to_date" as const, branch };
        }
      }
      if (!details.hasUpstream) {
        const publishRemoteName = yield* refs.resolvePushRemoteName(cwd, branch);
        if (!publishRemoteName) {
          return yield* createGitCommandError(
            "GitCore.pushCurrentBranch",
            cwd,
            ["push"],
            "Cannot push because no git remote is configured for this repository.",
          );
        }
        yield* runGit("GitCore.pushCurrentBranch.pushWithUpstream", cwd, [
          "push",
          "-u",
          publishRemoteName,
          branch,
        ]);
        return {
          status: "pushed" as const,
          branch,
          upstreamBranch: `${publishRemoteName}/${branch}`,
          setUpstream: true,
        };
      }
      const currentUpstream = yield* refs
        .resolveCurrentUpstream(cwd)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (currentUpstream) {
        yield* runGit("GitCore.pushCurrentBranch.pushUpstream", cwd, [
          "push",
          currentUpstream.remoteName,
          `HEAD:${currentUpstream.upstreamBranch}`,
        ]);
        return {
          status: "pushed" as const,
          branch,
          upstreamBranch: currentUpstream.upstreamRef,
          setUpstream: false,
        };
      }
      yield* runGit("GitCore.pushCurrentBranch.push", cwd, ["push"]);
      return {
        status: "pushed" as const,
        branch,
        ...(details.upstreamRef ? { upstreamBranch: details.upstreamRef } : {}),
        setUpstream: false,
      };
    });

  const pullCurrentBranch: GitCoreShape["pullCurrentBranch"] = (cwd) =>
    Effect.gen(function* () {
      const details = yield* statusOperations.statusDetails(cwd);
      const branch = details.branch;
      if (!branch) {
        return yield* createGitCommandError(
          "GitCore.pullCurrentBranch",
          cwd,
          ["pull", "--ff-only"],
          "Cannot pull from detached HEAD.",
        );
      }
      if (!details.hasUpstream) {
        return yield* createGitCommandError(
          "GitCore.pullCurrentBranch",
          cwd,
          ["pull", "--ff-only"],
          "Current branch has no upstream configured. Push with upstream first.",
        );
      }
      const beforeSha = yield* runGitStdout(
        "GitCore.pullCurrentBranch.beforeSha",
        cwd,
        ["rev-parse", "HEAD"],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));
      yield* executeGit("GitCore.pullCurrentBranch.pull", cwd, ["pull", "--ff-only"], {
        timeoutMs: 30_000,
        fallbackErrorMessage: "git pull failed",
      }).pipe(
        Effect.mapError((error) => {
          const friendlyDetail = explainPullBlockedByLocalChanges(error);
          return friendlyDetail
            ? createGitCommandError(
                "GitCore.pullCurrentBranch.pull",
                cwd,
                ["pull", "--ff-only"],
                friendlyDetail,
                error,
              )
            : error;
        }),
      );
      const afterSha = yield* runGitStdout(
        "GitCore.pullCurrentBranch.afterSha",
        cwd,
        ["rev-parse", "HEAD"],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));
      const refreshed = yield* statusOperations.statusDetails(cwd);
      return {
        status: beforeSha.length > 0 && beforeSha === afterSha ? "skipped_up_to_date" : "pulled",
        branch,
        upstreamBranch: refreshed.upstreamRef,
      };
    });

  return { pushCurrentBranch, pullCurrentBranch };
}
