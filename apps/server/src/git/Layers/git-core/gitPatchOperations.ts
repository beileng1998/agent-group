import { Effect } from "effect";

import type { GitCommitOptions, GitCoreShape } from "../../Services/GitCore.ts";
import type { GitOperationContext } from "./gitCoreTypes.ts";
import type { GitRepositoryRefs } from "./gitRepositoryRefs.ts";
import type { GitStatusOperations } from "./gitStatusOperations.ts";
import {
  EMPTY_TREE_OBJECT_ID,
  MAX_UNTRACKED_DIFF_CONCURRENCY,
  WORKING_TREE_DIFF_TIMEOUT_MS,
  createGitCommandError,
  joinPatchSegments,
} from "./gitCoreValues.ts";

export function makeGitPatchOperations(
  context: GitOperationContext,
  refs: GitRepositoryRefs,
  statusOperations: GitStatusOperations,
) {
  const { execute, executeGit, runGit, runGitStdout } = context;
  const readUntrackedPatches = (cwd: string, operationPrefix: string) =>
    runGitStdout(
      `${operationPrefix}.untrackedFiles`,
      cwd,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      true,
    ).pipe(
      Effect.map((stdout) => stdout.split("\0").filter((entry) => entry.length > 0)),
      Effect.flatMap((untrackedFiles) =>
        Effect.forEach(
          untrackedFiles,
          (filePath) =>
            executeGit(
              `${operationPrefix}.untrackedPatch`,
              cwd,
              [
                "diff",
                "--no-index",
                "--patch",
                "--no-color",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                "--",
                "/dev/null",
                filePath,
              ],
              { allowNonZeroExit: true, timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS },
            ).pipe(Effect.map((result) => result.stdout)),
          { concurrency: MAX_UNTRACKED_DIFF_CONCURRENCY },
        ),
      ),
    );

  const readUnstagedPatch: GitCoreShape["readUnstagedPatch"] = (cwd) =>
    Effect.gen(function* () {
      const trackedPatch = yield* executeGit(
        "GitCore.readUnstagedPatch.trackedPatch",
        cwd,
        ["diff", "--patch", "--no-color", "--no-ext-diff"],
        { allowNonZeroExit: true, timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS },
      ).pipe(Effect.map((result) => result.stdout));
      const untrackedPatches = yield* readUntrackedPatches(cwd, "GitCore.readUnstagedPatch");
      return { patch: joinPatchSegments([trackedPatch, ...untrackedPatches]) };
    });

  const readStagedPatch: GitCoreShape["readStagedPatch"] = (cwd) =>
    executeGit(
      "GitCore.readStagedPatch",
      cwd,
      ["diff", "--cached", "--patch", "--no-color", "--no-ext-diff"],
      { allowNonZeroExit: true, timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS },
    ).pipe(Effect.map((result) => ({ patch: result.stdout })));

  const readWorkingTreePatch: GitCoreShape["readWorkingTreePatch"] = (cwd) =>
    Effect.gen(function* () {
      const headExists = yield* executeGit(
        "GitCore.readWorkingTreePatch.headExists",
        cwd,
        ["rev-parse", "--verify", "HEAD"],
        { allowNonZeroExit: true },
      ).pipe(Effect.map((result) => result.code === 0));
      const trackedPatch = yield* executeGit(
        "GitCore.readWorkingTreePatch.trackedPatch",
        cwd,
        headExists
          ? ["diff", "--patch", "--no-color", "--no-ext-diff", "HEAD"]
          : ["diff", "--patch", "--no-color", "--no-ext-diff", EMPTY_TREE_OBJECT_ID],
        { allowNonZeroExit: true, timeoutMs: WORKING_TREE_DIFF_TIMEOUT_MS },
      ).pipe(Effect.map((result) => result.stdout));
      const untrackedPatches = yield* readUntrackedPatches(cwd, "GitCore.readWorkingTreePatch");
      return { patch: joinPatchSegments([trackedPatch, ...untrackedPatches]) };
    });

  const readBranchPatch: GitCoreShape["readBranchPatch"] = (cwd) =>
    Effect.gen(function* () {
      const details = yield* statusOperations.statusDetails(cwd);
      const baseBranch =
        details.upstreamRef ??
        (details.branch
          ? yield* refs
              .resolveBaseBranchForNoUpstream(cwd, details.branch)
              .pipe(Effect.catch(() => Effect.succeed(null)))
          : null);
      if (!baseBranch) {
        return yield* createGitCommandError(
          "GitCore.readBranchPatch.base",
          cwd,
          ["diff", "--patch", "--minimal", "<base>...HEAD"],
          "Cannot resolve a base branch for the current branch diff.",
        );
      }
      const result = yield* execute({
        operation: "GitCore.readBranchPatch.diffPatch",
        cwd,
        args: [
          "diff",
          "--patch",
          "--minimal",
          "--no-color",
          "--no-ext-diff",
          `${baseBranch}...HEAD`,
        ],
        maxOutputBytes: 10_000_000,
      });
      return { patch: result.stdout };
    });

  const prepareCommitContext: GitCoreShape["prepareCommitContext"] = (cwd, filePaths) =>
    Effect.gen(function* () {
      if (filePaths && filePaths.length > 0) {
        yield* runGit("GitCore.prepareCommitContext.reset", cwd, ["reset"]).pipe(
          Effect.catch(() => Effect.void),
        );
        yield* runGit("GitCore.prepareCommitContext.addSelected", cwd, [
          "add",
          "-A",
          "--",
          ...filePaths,
        ]);
      } else {
        yield* runGit("GitCore.prepareCommitContext.addAll", cwd, ["add", "-A"]);
      }
      const stagedSummary = yield* runGitStdout("GitCore.prepareCommitContext.stagedSummary", cwd, [
        "diff",
        "--cached",
        "--name-status",
      ]).pipe(Effect.map((stdout) => stdout.trim()));
      if (stagedSummary.length === 0) return null;
      const stagedPatch = yield* runGitStdout("GitCore.prepareCommitContext.stagedPatch", cwd, [
        "diff",
        "--cached",
        "--patch",
        "--minimal",
      ]);
      return { stagedSummary, stagedPatch };
    });

  const commit: GitCoreShape["commit"] = (cwd, subject, body, options?: GitCommitOptions) =>
    Effect.gen(function* () {
      const args = ["commit", "-m", subject];
      const trimmedBody = body.trim();
      if (trimmedBody.length > 0) args.push("-m", trimmedBody);
      const progress = options?.progress
        ? {
            ...(options.progress.onOutputLine
              ? {
                  onStdoutLine: (line: string) =>
                    options.progress?.onOutputLine?.({ stream: "stdout", text: line }) ??
                    Effect.void,
                  onStderrLine: (line: string) =>
                    options.progress?.onOutputLine?.({ stream: "stderr", text: line }) ??
                    Effect.void,
                }
              : {}),
            ...(options.progress.onHookStarted
              ? { onHookStarted: options.progress.onHookStarted }
              : {}),
            ...(options.progress.onHookFinished
              ? { onHookFinished: options.progress.onHookFinished }
              : {}),
          }
        : null;
      yield* executeGit("GitCore.commit.commit", cwd, args, {
        ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(progress ? { progress } : {}),
      }).pipe(Effect.asVoid);
      const commitSha = yield* runGitStdout("GitCore.commit.revParseHead", cwd, [
        "rev-parse",
        "HEAD",
      ]).pipe(Effect.map((stdout) => stdout.trim()));
      return { commitSha };
    });

  const readRangeContext: GitCoreShape["readRangeContext"] = (cwd, baseBranch) =>
    Effect.gen(function* () {
      const range = `${baseBranch}..HEAD`;
      const [commitSummary, diffSummary, diffPatchResult] = yield* Effect.all(
        [
          runGitStdout("GitCore.readRangeContext.log", cwd, ["log", "--oneline", range]),
          runGitStdout("GitCore.readRangeContext.diffStat", cwd, ["diff", "--stat", range]),
          execute({
            operation: "GitCore.readRangeContext.diffPatch",
            cwd,
            args: ["diff", "--patch", "--minimal", range],
            maxOutputBytes: 10_000_000,
          }),
        ],
        { concurrency: "unbounded" },
      );
      return { commitSummary, diffSummary, diffPatch: diffPatchResult.stdout };
    });

  const readConfigValue: GitCoreShape["readConfigValue"] = (cwd, key) =>
    runGitStdout("GitCore.readConfigValue", cwd, ["config", "--get", key], true).pipe(
      Effect.map((stdout) => stdout.trim()),
      Effect.map((trimmed) => (trimmed.length > 0 ? trimmed : null)),
    );

  return {
    readWorkingTreePatch,
    readUnstagedPatch,
    readStagedPatch,
    readBranchPatch,
    prepareCommitContext,
    commit,
    readRangeContext,
    readConfigValue,
  };
}
