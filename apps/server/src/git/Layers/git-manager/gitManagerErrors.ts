import { GitManagerError } from "../../Errors.ts";
import type {
  FailedLocalHandoffRecovery,
  FailedLocalTransferRecovery,
  FailedWorktreeHandoffRecovery,
  FailedWorktreeTransferRecovery,
} from "./gitManagerTypes.ts";

export function gitManagerError(
  operation: string,
  detail: string,
  cause?: unknown,
): GitManagerError {
  return new GitManagerError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

export function buildFailedLocalHandoffRecoveryDetail(
  baseMessage: string,
  recovery: FailedLocalHandoffRecovery,
): string {
  return `${baseMessage} ${[
    recovery.worktreeRecreated
      ? "The original worktree was recreated."
      : "The original worktree could not be recreated automatically.",
    recovery.worktreeChangesRestored
      ? "Recovered worktree changes were reapplied."
      : "Recovered worktree changes remain in the Git stash.",
    recovery.localChangesRestored
      ? "Previous local changes were restored."
      : "Previous local changes remain in the Git stash.",
    ...recovery.recoveryNotes,
  ].join(" ")}`.trim();
}

export function buildFailedLocalTransferDetail(
  baseMessage: string,
  recovery: FailedLocalTransferRecovery,
): string {
  return `${baseMessage} ${[
    recovery.worktreeRecreated
      ? "The original worktree was recreated."
      : "The original worktree could not be recreated automatically.",
    recovery.worktreeChangesRestored
      ? "The thread changes were restored to that worktree."
      : "The thread changes remain in the Git stash.",
    recovery.localCheckoutRestored
      ? "Local checkout was restored."
      : "Local checkout could not be fully restored automatically.",
    recovery.localChangesRestored
      ? "Previous local changes were restored."
      : "Previous local changes remain in the Git stash.",
    ...recovery.recoveryNotes,
  ].join(" ")}`.trim();
}

export function buildFailedWorktreeHandoffRecoveryDetail(
  baseMessage: string,
  recovery: FailedWorktreeHandoffRecovery,
): string {
  return `${baseMessage} ${[
    recovery.checkoutRestored
      ? "Local checkout was restored."
      : "Local checkout could not be fully restored automatically.",
    recovery.stashRestored
      ? "Previous local changes were restored."
      : "Previous local changes remain in the Git stash.",
    ...recovery.recoveryNotes,
  ].join(" ")}`.trim();
}

export function buildFailedWorktreeTransferDetail(
  baseMessage: string,
  recovery: FailedWorktreeTransferRecovery,
): string {
  return `${baseMessage} ${[
    recovery.worktreeRemoved
      ? "The new worktree was removed."
      : "The new worktree could not be removed automatically.",
    recovery.checkoutRestored
      ? "Local checkout was restored."
      : "Local checkout could not be fully restored automatically.",
    recovery.stashRestored
      ? "Previous local changes were restored."
      : "Previous local changes remain in the Git stash. Run `git stash list` in Local to recover them.",
    ...recovery.recoveryNotes,
  ].join(" ")}`.trim();
}
