import type { Effect, FileSystem, Path } from "effect";

import type { GitCommandError } from "../../Errors.ts";
import type { ExecuteGitProgress, GitCoreShape } from "../../Services/GitCore.ts";

export interface ExecuteGitOptions {
  timeoutMs?: number | undefined;
  allowNonZeroExit?: boolean | undefined;
  fallbackErrorMessage?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  progress?: ExecuteGitProgress | undefined;
}

export interface GitOperationContext {
  readonly execute: GitCoreShape["execute"];
  readonly executeGit: (
    operation: string,
    cwd: string,
    args: readonly string[],
    options?: ExecuteGitOptions,
  ) => Effect.Effect<{ code: number; stdout: string; stderr: string }, GitCommandError>;
  readonly runGit: (
    operation: string,
    cwd: string,
    args: readonly string[],
    allowNonZeroExit?: boolean,
  ) => Effect.Effect<void, GitCommandError>;
  readonly runGitStdout: (
    operation: string,
    cwd: string,
    args: readonly string[],
    allowNonZeroExit?: boolean,
  ) => Effect.Effect<string, GitCommandError>;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly worktreesDir: string;
}

export type WorkingTreeFileStat = {
  path: string;
  insertions: number;
  deletions: number;
};

export type WorkingTreeStatSummary = {
  files: WorkingTreeFileStat[];
  insertions: number;
  deletions: number;
};
