import { Effect, Exit } from "effect";
import * as nodePath from "node:path";

import type { GitCoreShape } from "../../Services/GitCore.ts";
import type { GitOperationContext } from "./gitCoreTypes.ts";
import {
  createGitCommandError,
  parseNonEmptyLineList,
  parseStashEntries,
  type StashEntry,
} from "./gitCoreValues.ts";

export function makeGitWorkspaceOperations(
  context: GitOperationContext,
  checkoutBranch: GitCoreShape["checkoutBranch"],
) {
  const { executeGit, fileSystem, runGit, runGitStdout } = context;
  const listStashEntries = (operation: string, cwd: string) =>
    executeGit(operation, cwd, ["stash", "list", "--format=%gd %H"], {
      timeoutMs: 10_000,
    }).pipe(Effect.map((result) => parseStashEntries(result.stdout)));
  const dropStashByHash = (cwd: string, hash: string) =>
    Effect.gen(function* () {
      const entries = yield* listStashEntries("GitCore.dropStashByHash.list", cwd);
      const entry = entries.find((candidate: StashEntry) => candidate.hash === hash);
      if (!entry) return;
      yield* executeGit("GitCore.dropStashByHash.drop", cwd, ["stash", "drop", entry.ref], {
        timeoutMs: 10_000,
        fallbackErrorMessage: "git stash drop failed",
      });
    });

  const stashAndCheckout: GitCoreShape["stashAndCheckout"] = (input) =>
    Effect.gen(function* () {
      const stashBefore = yield* listStashEntries(
        "GitCore.stashAndCheckout.stashListBefore",
        input.cwd,
      );
      yield* executeGit(
        "GitCore.stashAndCheckout.stashPush",
        input.cwd,
        ["stash", "push", "-u", "-m", `agent-group: stash before switching to ${input.branch}`],
        { timeoutMs: 30_000, fallbackErrorMessage: "git stash failed" },
      );
      const stashAfter = yield* listStashEntries(
        "GitCore.stashAndCheckout.stashListAfter",
        input.cwd,
      );
      const stashBeforeHashes = new Set(stashBefore.map((entry) => entry.hash));
      const createdStash =
        stashAfter.find((entry) => !stashBeforeHashes.has(entry.hash)) ??
        (stashAfter.length > stashBefore.length ? stashAfter[0] : undefined);
      const checkoutResult = yield* Effect.exit(checkoutBranch(input));
      if (Exit.isFailure(checkoutResult)) {
        if (createdStash) {
          const restoreResult = yield* executeGit(
            "GitCore.stashAndCheckout.restoreAfterCheckoutFailure.apply",
            input.cwd,
            ["stash", "apply", createdStash.hash],
            { timeoutMs: 30_000, allowNonZeroExit: true },
          );
          if (restoreResult.code === 0) {
            yield* dropStashByHash(input.cwd, createdStash.hash).pipe(
              Effect.catchTag("GitCommandError", (error) =>
                Effect.logWarning(
                  `Could not drop restored stash ${createdStash.hash}: ${error.message}`,
                ),
              ),
            );
          }
        }
        return yield* Effect.failCause(checkoutResult.cause);
      }
      if (!createdStash) return;
      const applyResult = yield* executeGit(
        "GitCore.stashAndCheckout.stashApply",
        input.cwd,
        ["stash", "apply", createdStash.hash],
        { timeoutMs: 30_000, allowNonZeroExit: true },
      );
      if (applyResult.code === 0) {
        yield* dropStashByHash(input.cwd, createdStash.hash).pipe(
          Effect.catchTag("GitCommandError", (error) =>
            Effect.logWarning(
              `Could not drop reapplied stash ${createdStash.hash}: ${error.message}`,
            ),
          ),
        );
        return;
      }
      yield* executeGit(
        "GitCore.stashAndCheckout.abortConflictedApply",
        input.cwd,
        ["reset", "--hard"],
        { timeoutMs: 30_000, allowNonZeroExit: true },
      ).pipe(Effect.ignore);
      yield* executeGit(
        "GitCore.stashAndCheckout.cleanConflictedApply",
        input.cwd,
        ["clean", "-fd"],
        { timeoutMs: 30_000, allowNonZeroExit: true },
      ).pipe(Effect.ignore);
      return yield* createGitCommandError(
        "GitCore.stashAndCheckout.stashApply",
        input.cwd,
        ["stash", "apply", createdStash.hash],
        "Stash could not be applied. Your changes are still saved in the stash.",
      );
    });

  const stashDrop: GitCoreShape["stashDrop"] = (input) =>
    executeGit("GitCore.stashDrop", input.cwd, ["stash", "drop"], {
      timeoutMs: 10_000,
      fallbackErrorMessage: "git stash drop failed",
    }).pipe(Effect.asVoid);

  const stashInfo: GitCoreShape["stashInfo"] = (input) =>
    Effect.gen(function* () {
      const stashLine = (yield* runGitStdout("GitCore.stashInfo.list", input.cwd, [
        "stash",
        "list",
        "-n",
        "1",
        "--format=%gd%x09%gs",
      ])).trim();
      const separatorIndex = stashLine.indexOf("\t");
      const stashRef =
        separatorIndex >= 0 ? stashLine.slice(0, separatorIndex).trim() : stashLine.trim();
      const message =
        separatorIndex >= 0 ? stashLine.slice(separatorIndex + 1).trim() : stashLine.trim();
      if (stashRef.length === 0 || message.length === 0) {
        return yield* createGitCommandError(
          "GitCore.stashInfo",
          input.cwd,
          ["stash", "list", "-n", "1", "--format=%gd%x09%gs"],
          "No stash entry is available.",
        );
      }
      const branchOutput = yield* runGitStdout("GitCore.stashInfo.branch", input.cwd, [
        "branch",
        "--show-current",
      ]).pipe(Effect.catch(() => Effect.succeed("")));
      const filesOutput = yield* runGitStdout("GitCore.stashInfo.files", input.cwd, [
        "stash",
        "show",
        "--include-untracked",
        "--name-only",
        stashRef,
      ]).pipe(Effect.catch(() => Effect.succeed("")));
      return {
        cwd: input.cwd,
        branch: branchOutput.trim() || null,
        stashRef,
        message,
        files: parseNonEmptyLineList(filesOutput),
      };
    });

  const removeIndexLock: GitCoreShape["removeIndexLock"] = (input) =>
    Effect.gen(function* () {
      const lockPathOutput = yield* runGitStdout("GitCore.removeIndexLock.resolvePath", input.cwd, [
        "rev-parse",
        "--git-path",
        "index.lock",
      ]);
      const rawLockPath = lockPathOutput.trim();
      if (rawLockPath.length === 0 || nodePath.basename(rawLockPath) !== "index.lock") {
        return yield* createGitCommandError(
          "GitCore.removeIndexLock",
          input.cwd,
          ["rev-parse", "--git-path", "index.lock"],
          "Git did not return a valid index lock path.",
        );
      }
      const lockPath = nodePath.isAbsolute(rawLockPath)
        ? rawLockPath
        : nodePath.resolve(input.cwd, rawLockPath);
      yield* fileSystem
        .remove(lockPath)
        .pipe(
          Effect.mapError((cause) =>
            createGitCommandError(
              "GitCore.removeIndexLock",
              input.cwd,
              ["rm", lockPath],
              cause.message,
              cause,
            ),
          ),
        );
    });

  const initRepo: GitCoreShape["initRepo"] = (input) =>
    executeGit("GitCore.initRepo", input.cwd, ["init"], {
      timeoutMs: 10_000,
      fallbackErrorMessage: "git init failed",
    }).pipe(Effect.asVoid);
  const listLocalBranchNames: GitCoreShape["listLocalBranchNames"] = (cwd) =>
    runGitStdout("GitCore.listLocalBranchNames", cwd, [
      "branch",
      "--list",
      "--format=%(refname:short)",
    ]).pipe(
      Effect.map((stdout) =>
        stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    );
  const stageFiles: GitCoreShape["stageFiles"] = (cwd, paths) =>
    runGit("GitCore.stageFiles", cwd, ["add", "--", ...paths]);
  const unstageFiles: GitCoreShape["unstageFiles"] = (cwd, paths) =>
    Effect.gen(function* () {
      const headExists = yield* executeGit(
        "GitCore.unstageFiles.headExists",
        cwd,
        ["rev-parse", "--verify", "HEAD"],
        { allowNonZeroExit: true },
      ).pipe(Effect.map((result) => result.code === 0));
      yield* runGit(
        "GitCore.unstageFiles",
        cwd,
        headExists
          ? ["reset", "-q", "HEAD", "--", ...paths]
          : ["rm", "--cached", "-q", "--", ...paths],
      );
    });

  return {
    stashAndCheckout,
    stashDrop,
    stashInfo,
    removeIndexLock,
    initRepo,
    listLocalBranchNames,
    stageFiles,
    unstageFiles,
  };
}
