import { Effect } from "effect";

import type { GitCoreShape } from "../../Services/GitCore.ts";
import type { GitOperationContext } from "./gitCoreTypes.ts";
import {
  createGitCommandError,
  isMissingGitCwdError,
  parseBranchLine,
  parseRemoteNames,
  parseRemoteRefWithRemoteNames,
} from "./gitCoreValues.ts";

export function makeGitBranchListing(context: GitOperationContext) {
  const { executeGit, fileSystem } = context;
  const readBranchRecency = (cwd: string) =>
    Effect.gen(function* () {
      const branchRecency = yield* executeGit(
        "GitCore.readBranchRecency",
        cwd,
        [
          "for-each-ref",
          "--format=%(refname:short)%09%(committerdate:unix)",
          "refs/heads",
          "refs/remotes",
        ],
        { timeoutMs: 15_000, allowNonZeroExit: true },
      );
      const branchLastCommit = new Map<string, number>();
      if (branchRecency.code !== 0) return branchLastCommit;
      for (const line of branchRecency.stdout.split("\n")) {
        if (line.length === 0) continue;
        const [name, lastCommitRaw] = line.split("\t");
        if (!name) continue;
        const lastCommit = Number.parseInt(lastCommitRaw ?? "0", 10);
        branchLastCommit.set(name, Number.isFinite(lastCommit) ? lastCommit : 0);
      }
      return branchLastCommit;
    });

  const listBranches: GitCoreShape["listBranches"] = (input) =>
    Effect.gen(function* () {
      const branchRecencyPromise = readBranchRecency(input.cwd).pipe(
        Effect.catch(() => Effect.succeed(new Map<string, number>())),
      );
      const localBranchResult = yield* executeGit(
        "GitCore.listBranches.branchNoColor",
        input.cwd,
        ["branch", "--no-color"],
        { timeoutMs: 10_000, allowNonZeroExit: true },
      ).pipe(
        Effect.catchIf(isMissingGitCwdError, () =>
          Effect.succeed({
            code: 128,
            stdout: "",
            stderr: "fatal: not a git repository",
          }),
        ),
      );
      if (localBranchResult.code !== 0) {
        const stderr = localBranchResult.stderr.trim();
        if (stderr.toLowerCase().includes("not a git repository")) {
          return { branches: [], isRepo: false, hasOriginRemote: false };
        }
        return yield* createGitCommandError(
          "GitCore.listBranches",
          input.cwd,
          ["branch", "--no-color"],
          stderr || "git branch failed",
        );
      }
      const remoteBranchResultEffect = executeGit(
        "GitCore.listBranches.remoteBranches",
        input.cwd,
        ["branch", "--no-color", "--remotes"],
        { timeoutMs: 10_000, allowNonZeroExit: true },
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            `GitCore.listBranches: remote branch lookup failed for ${input.cwd}: ${error.message}. Falling back to an empty remote branch list.`,
          ).pipe(Effect.as({ code: 1, stdout: "", stderr: "" })),
        ),
      );
      const remoteNamesResultEffect = executeGit(
        "GitCore.listBranches.remoteNames",
        input.cwd,
        ["remote"],
        { timeoutMs: 5_000, allowNonZeroExit: true },
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            `GitCore.listBranches: remote name lookup failed for ${input.cwd}: ${error.message}. Falling back to an empty remote name list.`,
          ).pipe(Effect.as({ code: 1, stdout: "", stderr: "" })),
        ),
      );
      const branchMetadata = yield* Effect.all(
        [
          executeGit(
            "GitCore.listBranches.defaultRef",
            input.cwd,
            ["symbolic-ref", "refs/remotes/origin/HEAD"],
            { timeoutMs: 5_000, allowNonZeroExit: true },
          ),
          executeGit(
            "GitCore.listBranches.worktreeList",
            input.cwd,
            ["worktree", "list", "--porcelain"],
            { timeoutMs: 5_000, allowNonZeroExit: true },
          ),
          remoteBranchResultEffect,
          remoteNamesResultEffect,
          branchRecencyPromise,
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(null)));
      if (branchMetadata === null) return { branches: [], isRepo: false, hasOriginRemote: false };
      const [defaultRef, worktreeList, remoteBranchResult, remoteNamesResult, branchLastCommit] =
        branchMetadata;
      const remoteNames =
        remoteNamesResult.code === 0 ? parseRemoteNames(remoteNamesResult.stdout) : [];
      if (remoteBranchResult.code !== 0 && remoteBranchResult.stderr.trim().length > 0) {
        yield* Effect.logWarning(
          `GitCore.listBranches: remote branch lookup returned code ${remoteBranchResult.code} for ${input.cwd}: ${remoteBranchResult.stderr.trim()}. Falling back to an empty remote branch list.`,
        );
      }
      if (remoteNamesResult.code !== 0 && remoteNamesResult.stderr.trim().length > 0) {
        yield* Effect.logWarning(
          `GitCore.listBranches: remote name lookup returned code ${remoteNamesResult.code} for ${input.cwd}: ${remoteNamesResult.stderr.trim()}. Falling back to an empty remote name list.`,
        );
      }
      const defaultBranch =
        defaultRef.code === 0
          ? defaultRef.stdout.trim().replace(/^refs\/remotes\/origin\//, "")
          : null;
      const worktreeMap = new Map<string, string>();
      if (worktreeList.code === 0) {
        let currentPath: string | null = null;
        for (const line of worktreeList.stdout.split("\n")) {
          if (line.startsWith("worktree ")) {
            const candidatePath = line.slice("worktree ".length);
            const exists = yield* fileSystem.stat(candidatePath).pipe(
              Effect.map(() => true),
              Effect.catch(() => Effect.succeed(false)),
            );
            currentPath = exists ? candidatePath : null;
          } else if (line.startsWith("branch refs/heads/") && currentPath) {
            worktreeMap.set(line.slice("branch refs/heads/".length), currentPath);
          } else if (line === "") {
            currentPath = null;
          }
        }
      }
      const localBranches = localBranchResult.stdout
        .split("\n")
        .map(parseBranchLine)
        .filter((branch): branch is { name: string; current: boolean } => branch !== null)
        .map((branch) => ({
          name: branch.name,
          current: branch.current,
          isRemote: false,
          isDefault: branch.name === defaultBranch,
          worktreePath: worktreeMap.get(branch.name) ?? null,
        }))
        .toSorted((a, b) => {
          const aPriority = a.current ? 0 : a.isDefault ? 1 : 2;
          const bPriority = b.current ? 0 : b.isDefault ? 1 : 2;
          if (aPriority !== bPriority) return aPriority - bPriority;
          const aLastCommit = branchLastCommit.get(a.name) ?? 0;
          const bLastCommit = branchLastCommit.get(b.name) ?? 0;
          return aLastCommit !== bLastCommit
            ? bLastCommit - aLastCommit
            : a.name.localeCompare(b.name);
        });
      const remoteBranches =
        remoteBranchResult.code === 0
          ? remoteBranchResult.stdout
              .split("\n")
              .map(parseBranchLine)
              .filter((branch): branch is { name: string; current: boolean } => branch !== null)
              .map((branch) => {
                const parsedRemoteRef = parseRemoteRefWithRemoteNames(branch.name, remoteNames);
                const remoteBranch: {
                  name: string;
                  current: boolean;
                  isRemote: boolean;
                  remoteName?: string;
                  isDefault: boolean;
                  worktreePath: string | null;
                } = {
                  name: branch.name,
                  current: false,
                  isRemote: true,
                  isDefault: false,
                  worktreePath: null,
                };
                if (parsedRemoteRef) remoteBranch.remoteName = parsedRemoteRef.remoteName;
                return remoteBranch;
              })
              .toSorted((a, b) => {
                const aLastCommit = branchLastCommit.get(a.name) ?? 0;
                const bLastCommit = branchLastCommit.get(b.name) ?? 0;
                return aLastCommit !== bLastCommit
                  ? bLastCommit - aLastCommit
                  : a.name.localeCompare(b.name);
              })
          : [];
      return {
        branches: [...localBranches, ...remoteBranches],
        isRepo: true,
        hasOriginRemote: remoteNames.includes("origin"),
      };
    });
  return { listBranches };
}
