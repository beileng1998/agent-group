import { Effect } from "effect";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";

import type { GitCoreShape } from "../../Services/GitCore.ts";
import type { GitOperationContext, WorkingTreeStatSummary } from "./gitCoreTypes.ts";
import type { GitRepositoryRefs } from "./gitRepositoryRefs.ts";
import {
  MOVE_AWARE_WORKING_TREE_STATUS_TIMEOUT_MS,
  NON_REPOSITORY_STATUS_DETAILS,
  commandLabel,
  countTextLines,
  createGitCommandError,
  hasNodeErrorCode,
  isMissingGitCwdError,
  normalizeConfiguredMergeBranch,
  parseBranchAb,
  parseNumstatEntries,
  parsePorcelainPath,
  resolveGitPath,
  summarizeNumstatEntries,
} from "./gitCoreValues.ts";

export function makeGitStatusOperations(context: GitOperationContext, refs: GitRepositoryRefs) {
  const { executeGit, fileSystem, runGitStdout } = context;
  const readMoveAwareWorkingTreeSummary = (
    cwd: string,
  ): Effect.Effect<WorkingTreeStatSummary | null, never> =>
    Effect.scoped(
      Effect.gen(function* () {
        const indexPathRaw = yield* runGitStdout("GitCore.statusDetails.moveAwareIndexPath", cwd, [
          "rev-parse",
          "--git-path",
          "index",
        ]).pipe(Effect.map((stdout) => stdout.trim()));
        if (indexPathRaw.length === 0) return null;
        const tempIndexDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: `agent-group-git-status-index-${process.pid}-`,
        });
        const tempIndexPath = nodePath.join(tempIndexDir, "index");
        yield* Effect.tryPromise(() =>
          nodeFs.copyFile(resolveGitPath(cwd, indexPathRaw), tempIndexPath),
        ).pipe(
          Effect.catch((cause) =>
            hasNodeErrorCode(cause, "ENOENT") ? Effect.void : Effect.fail(cause),
          ),
        );
        const tempIndexEnv = { GIT_INDEX_FILE: tempIndexPath };
        yield* executeGit("GitCore.statusDetails.moveAwareAddAll", cwd, ["add", "-A", "--", ":/"], {
          env: tempIndexEnv,
          timeoutMs: MOVE_AWARE_WORKING_TREE_STATUS_TIMEOUT_MS,
          fallbackErrorMessage: "git add -A failed while summarizing working tree status",
        });
        const numstatStdout = yield* executeGit(
          "GitCore.statusDetails.moveAwareNumstat",
          cwd,
          ["diff", "--cached", "--numstat", "--find-renames"],
          {
            env: tempIndexEnv,
            allowNonZeroExit: true,
            timeoutMs: MOVE_AWARE_WORKING_TREE_STATUS_TIMEOUT_MS,
          },
        ).pipe(Effect.map((result) => result.stdout));
        return summarizeNumstatEntries(parseNumstatEntries(numstatStdout));
      }),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logDebug(
          "GitCore.statusDetails: move-aware working tree summary failed",
          cause,
        ).pipe(Effect.as(null)),
      ),
    );

  const statusDetails: GitCoreShape["statusDetails"] = (cwd) =>
    Effect.gen(function* () {
      const operation = "GitCore.statusDetails.isInsideWorkTree";
      const args = ["rev-parse", "--is-inside-work-tree"] as const;
      const isInsideWorkTree = yield* executeGit(operation, cwd, args, {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
      }).pipe(
        Effect.flatMap((result) => {
          if (result.code === 0) return Effect.succeed(result.stdout.trim() === "true");
          if (result.code === 128 && result.stderr.toLowerCase().includes("not a git repository")) {
            return Effect.succeed(false);
          }
          return Effect.fail(
            createGitCommandError(
              operation,
              cwd,
              args,
              result.stderr.trim() || `${commandLabel(args)} failed: code=${result.code}`,
            ),
          );
        }),
        Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(false)),
      );
      if (!isInsideWorkTree) return NON_REPOSITORY_STATUS_DETAILS;
      yield* refs.refreshStatusUpstreamIfStale(cwd).pipe(
        Effect.catchIf(isMissingGitCwdError, () => Effect.void),
        Effect.ignoreCause({ log: true }),
      );
      const statusStdout = yield* runGitStdout("GitCore.statusDetails.status", cwd, [
        "status",
        "--porcelain=2",
        "--branch",
      ]).pipe(Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(null)));
      if (statusStdout === null) return NON_REPOSITORY_STATUS_DETAILS;

      let branch: string | null = null;
      let upstreamRef: string | null = null;
      let upstreamBranch: string | null = null;
      let aheadCount = 0;
      let behindCount = 0;
      let hasWorkingTreeChanges = false;
      let hasTrackedDeletion = false;
      let hasUntrackedDirectory = false;
      const changedFilesWithoutNumstat = new Set<string>();
      const untrackedFilesWithoutNumstat = new Set<string>();
      for (const line of statusStdout.split(/\r?\n/g)) {
        if (line.startsWith("# branch.head ")) {
          const value = line.slice("# branch.head ".length).trim();
          branch = value.startsWith("(") ? null : value;
          continue;
        }
        if (line.startsWith("# branch.upstream ")) {
          const value = line.slice("# branch.upstream ".length).trim();
          upstreamRef = value.length > 0 ? value : null;
          continue;
        }
        if (line.startsWith("# branch.ab ")) {
          const parsed = parseBranchAb(line.slice("# branch.ab ".length).trim());
          aheadCount = parsed.ahead;
          behindCount = parsed.behind;
          continue;
        }
        if (line.trim().length > 0 && !line.startsWith("#")) {
          hasWorkingTreeChanges = true;
          const statusCode = line.startsWith("1 ") || line.startsWith("2 ") ? line.slice(2, 4) : "";
          if (statusCode.includes("D")) hasTrackedDeletion = true;
          const pathValue = parsePorcelainPath(line);
          if (pathValue) {
            changedFilesWithoutNumstat.add(pathValue);
            if (line.startsWith("? ")) {
              untrackedFilesWithoutNumstat.add(pathValue);
              if (pathValue.endsWith("/")) hasUntrackedDirectory = true;
            }
          }
        }
      }
      if (branch && upstreamRef) {
        upstreamBranch = yield* runGitStdout(
          "GitCore.statusDetails.upstreamMergeBranch",
          cwd,
          ["config", "--get", `branch.${branch}.merge`],
          true,
        ).pipe(
          Effect.map(normalizeConfiguredMergeBranch),
          Effect.catch(() => Effect.succeed(null)),
        );
      }
      if (!upstreamRef && branch) {
        aheadCount = yield* refs
          .computeAheadCountAgainstBase(cwd, branch)
          .pipe(Effect.catch(() => Effect.succeed(0)));
        behindCount = 0;
      }
      const primaryRemoteName = yield* refs
        .resolvePrimaryRemoteName(cwd)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      const defaultBranchName =
        primaryRemoteName === null
          ? null
          : yield* refs
              .resolveDefaultBranchName(cwd, primaryRemoteName)
              .pipe(Effect.catch(() => Effect.succeed(null)));
      const repoMetadata = {
        isRepo: true,
        hasOriginRemote: primaryRemoteName === "origin",
        isDefaultBranch:
          branch !== null && defaultBranchName !== null && branch === defaultBranchName,
      } as const;
      const moveAwareWorkingTree =
        hasWorkingTreeChanges &&
        untrackedFilesWithoutNumstat.size > 0 &&
        (hasTrackedDeletion || hasUntrackedDirectory)
          ? yield* readMoveAwareWorkingTreeSummary(cwd)
          : null;
      if (moveAwareWorkingTree) {
        return {
          ...repoMetadata,
          branch,
          upstreamRef,
          upstreamBranch,
          hasWorkingTreeChanges,
          workingTree: moveAwareWorkingTree,
          hasUpstream: upstreamRef !== null,
          aheadCount,
          behindCount,
        };
      }
      const numstatOutputs = yield* Effect.all(
        [
          runGitStdout("GitCore.statusDetails.unstagedNumstat", cwd, ["diff", "--numstat"]),
          runGitStdout("GitCore.statusDetails.stagedNumstat", cwd, [
            "diff",
            "--cached",
            "--numstat",
          ]),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(null)));
      if (numstatOutputs === null) return NON_REPOSITORY_STATUS_DETAILS;
      const [unstagedNumstatStdout, stagedNumstatStdout] = numstatOutputs;
      const workingTree = summarizeNumstatEntries([
        ...parseNumstatEntries(stagedNumstatStdout),
        ...parseNumstatEntries(unstagedNumstatStdout),
      ]);
      const files = [...workingTree.files];
      const numstatFilePaths = new Set(files.map((file) => file.path));
      const filePathsWithStats = new Set(numstatFilePaths);
      let insertions = workingTree.insertions;
      let deletions = workingTree.deletions;
      for (const filePath of changedFilesWithoutNumstat) {
        if (filePathsWithStats.has(filePath)) continue;
        const insertions = untrackedFilesWithoutNumstat.has(filePath)
          ? yield* Effect.tryPromise(() => nodeFs.readFile(nodePath.join(cwd, filePath))).pipe(
              Effect.map((contents) => countTextLines(new Uint8Array(contents))),
              Effect.catch(() => Effect.succeed(0)),
            )
          : 0;
        files.push({ path: filePath, insertions, deletions: 0 });
        filePathsWithStats.add(filePath);
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      for (const file of files) {
        if (numstatFilePaths.has(file.path)) continue;
        insertions += file.insertions;
        deletions += file.deletions;
      }
      return {
        ...repoMetadata,
        branch,
        upstreamRef,
        upstreamBranch,
        hasWorkingTreeChanges,
        workingTree: { files, insertions, deletions },
        hasUpstream: upstreamRef !== null,
        aheadCount,
        behindCount,
      };
    });

  const status: GitCoreShape["status"] = (input) =>
    statusDetails(input.cwd).pipe(
      Effect.map((details) => ({
        branch: details.branch,
        hasWorkingTreeChanges: details.hasWorkingTreeChanges,
        workingTree: details.workingTree,
        hasUpstream: details.hasUpstream,
        upstreamBranch: details.upstreamBranch,
        aheadCount: details.aheadCount,
        behindCount: details.behindCount,
        pr: null,
      })),
    );
  return { status, statusDetails };
}

export type GitStatusOperations = ReturnType<typeof makeGitStatusOperations>;
