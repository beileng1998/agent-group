import type { GitBranch, GitStatusResult } from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";

import type { EnvMode } from "../BranchToolbar.logic";

const DIRTY_WORKTREE_ERROR_PATTERN =
  /Uncommitted changes block checkout to ([^:\n]+):\s*\n((?:\s*-\s*.+(?:\n|$))+)/;
const STASH_CONFLICT_PATTERN = /Stash could not be applied|Stash applied with merge conflicts/;
const UNRESOLVED_INDEX_PATTERN = /you need to resolve your current index/i;
const GIT_INDEX_LOCK_PATTERN =
  /(?:Unable to create '([^']*\.git\/index\.lock)'|Another git process seems to be running|\.git\/index\.lock.*File exists)/i;
const GIT_INDEX_WRITE_PATTERN = /could not write index/i;

export function toBranchActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

export function parseDirtyWorktreeError(
  error: unknown,
): { branch: string; files: string[] } | null {
  const detail = error instanceof Error ? error.message : String(error);
  const match = DIRTY_WORKTREE_ERROR_PATTERN.exec(detail);
  if (!match?.[1] || !match[2]) return null;
  const files = match[2]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter((line) => line.length > 0);
  if (files.length === 0) return null;
  return { branch: match[1].trim(), files };
}

export function isStashConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return STASH_CONFLICT_PATTERN.test(message);
}

export function isUnresolvedIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return UNRESOLVED_INDEX_PATTERN.test(message);
}

export function parseGitIndexLockError(error: unknown): { lockPath: string | null } | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = GIT_INDEX_LOCK_PATTERN.exec(message);
  if (!match) return null;
  return { lockPath: match[1]?.trim() || null };
}

export function isGitIndexWriteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return GIT_INDEX_WRITE_PATTERN.test(message);
}

export function formatDirtyWorktreeDescription(files: string[]): string {
  const basenames = files.map((file) => file.split("/").pop() ?? file);
  if (basenames.length <= 3) {
    return `${basenames.join(", ")} ${pluralize(basenames.length, "has", "have")} uncommitted changes. Commit or stash before switching.`;
  }
  const remaining = basenames.length - 2;
  return `${basenames.slice(0, 2).join(", ")} and ${remaining} other ${pluralize(remaining, "file")} have uncommitted changes. Commit or stash before switching.`;
}

export function getBranchTriggerLabel(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
  resolvedActiveBranch: string | null;
}): string {
  if (!input.resolvedActiveBranch) return "Select branch";
  if (input.effectiveEnvMode === "worktree" && !input.activeWorktreePath) {
    return `From ${input.resolvedActiveBranch}`;
  }
  return input.resolvedActiveBranch;
}

export function getCreateBranchActionLabel(trimmedBranchQuery: string): string {
  return trimmedBranchQuery.length > 0
    ? `Create and checkout "${trimmedBranchQuery}"`
    : "Create and checkout new branch...";
}

export function getCurrentBranchChangeSummary(
  branch: GitBranch,
  branchStatus: GitStatusResult | null | undefined,
): { fileCount: number; insertions: number; deletions: number } | null {
  if (!branch.current || !branchStatus?.hasWorkingTreeChanges) return null;
  return {
    fileCount: branchStatus.workingTree.files.length,
    insertions: branchStatus.workingTree.insertions,
    deletions: branchStatus.workingTree.deletions,
  };
}
