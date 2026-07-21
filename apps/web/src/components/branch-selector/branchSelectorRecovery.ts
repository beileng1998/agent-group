import type { NativeApi } from "@agent-group/contracts";
import type { QueryClient } from "@tanstack/react-query";

import { invalidateGitQueries } from "../../lib/gitReactQuery";
import { toastManager } from "../ui/toast";
import {
  formatDirtyWorktreeDescription,
  isGitIndexWriteError,
  isStashConflictError,
  isUnresolvedIndexError,
  parseDirtyWorktreeError,
  parseGitIndexLockError,
  toBranchActionErrorMessage,
} from "./branchSelectorValues";

let activeBranchRecoveryToastId: ReturnType<typeof toastManager.add> | null = null;

function closeActiveBranchRecoveryToast(): void {
  if (!activeBranchRecoveryToastId) return;
  toastManager.close(activeBranchRecoveryToastId);
  activeBranchRecoveryToastId = null;
}

function addBranchRecoveryToast(input: Parameters<typeof toastManager.add>[0]) {
  closeActiveBranchRecoveryToast();
  activeBranchRecoveryToastId = toastManager.add(input);
  return activeBranchRecoveryToastId;
}

export interface CheckoutErrorInput {
  api: NativeApi;
  branch: string;
  cwd: string;
  fallbackTitle: string;
  onSuccess: () => void;
  queryClient: QueryClient;
  runBranchAction: (action: () => Promise<void>) => void;
  onRequestDiscardStash: (input: { cwd: string }) => void;
}

export function handleCheckoutError(error: unknown, input: CheckoutErrorInput): void {
  const retryStashAndCheckout = async (): Promise<void> => {
    await input.api.git.stashAndCheckout({ cwd: input.cwd, branch: input.branch });
    await invalidateGitQueries(input.queryClient);
    input.onSuccess();
  };

  const addGitIndexLockToast = (lockFailure: unknown): void => {
    const lockError = parseGitIndexLockError(lockFailure);
    if (!lockError) return;
    const lockFileLabel = lockError.lockPath
      ? lockError.lockPath.split("/").slice(-2).join("/")
      : ".git/index.lock";
    addBranchRecoveryToast({
      type: "error",
      title: "Git index is locked.",
      description: `${lockFileLabel} already exists. Close any running Git operation, remove the stale lock file if none is running, then retry.`,
      data: { copyText: toBranchActionErrorMessage(lockFailure) },
      actionProps: {
        children: "Remove lock & retry",
        onClick: () => {
          input.runBranchAction(async () => {
            try {
              await input.api.git.removeIndexLock({ cwd: input.cwd });
              await retryStashAndCheckout();
            } catch (retryError) {
              handleCheckoutError(retryError, input);
            }
          });
        },
      },
    });
  };

  const addGitIndexWriteToast = (writeFailure: unknown): void => {
    addBranchRecoveryToast({
      type: "error",
      title: "Git index could not be written.",
      description:
        "Git could not update the repository index. Retry after any current Git operation finishes.",
      data: { copyText: toBranchActionErrorMessage(writeFailure) },
      actionProps: {
        children: "Retry stash & switch",
        onClick: () => {
          input.runBranchAction(async () => {
            try {
              await retryStashAndCheckout();
            } catch (retryError) {
              handleCheckoutError(retryError, input);
            }
          });
        },
      },
    });
  };

  const dirtyWorktree = parseDirtyWorktreeError(error);
  if (dirtyWorktree) {
    const copyText = toBranchActionErrorMessage(error);
    addBranchRecoveryToast({
      type: "warning",
      title: "Uncommitted changes block checkout.",
      description: formatDirtyWorktreeDescription(dirtyWorktree.files),
      data: { copyText },
      actionProps: {
        children: "Stash & Switch",
        onClick: () => {
          closeActiveBranchRecoveryToast();
          input.runBranchAction(async () => {
            try {
              await retryStashAndCheckout();
            } catch (stashError) {
              if (parseGitIndexLockError(stashError)) {
                addGitIndexLockToast(stashError);
                return;
              }
              if (isGitIndexWriteError(stashError)) {
                addGitIndexWriteToast(stashError);
                return;
              }
              if (isStashConflictError(stashError)) {
                await invalidateGitQueries(input.queryClient);
                input.onSuccess();
                addBranchRecoveryToast({
                  type: "warning",
                  title: "Changes saved, but not reapplied.",
                  description:
                    "Agent Group switched branches and kept your changes in a stash because they could not be restored onto this branch cleanly.",
                  data: { copyText: toBranchActionErrorMessage(stashError) },
                  actionProps: {
                    children: "Discard stash",
                    className:
                      "border-destructive bg-destructive text-white shadow-destructive/24 hover:bg-destructive/90",
                    onClick: () => {
                      closeActiveBranchRecoveryToast();
                      input.onRequestDiscardStash({ cwd: input.cwd });
                    },
                  },
                });
                return;
              }
              if (parseDirtyWorktreeError(stashError)) {
                addBranchRecoveryToast({
                  type: "error",
                  title: "Cannot switch branches.",
                  description:
                    "Some conflicting files are not covered by git stash, such as ignored files. Move or remove them before switching.",
                  data: { copyText: toBranchActionErrorMessage(stashError) },
                });
                return;
              }
              addBranchRecoveryToast({
                type: "error",
                title: "Failed to stash and switch.",
                description: toBranchActionErrorMessage(stashError),
                data: { copyText: toBranchActionErrorMessage(stashError) },
              });
            }
          });
        },
      },
    });
    return;
  }

  if (parseGitIndexLockError(error)) {
    addGitIndexLockToast(error);
    return;
  }
  if (isGitIndexWriteError(error)) {
    addGitIndexWriteToast(error);
    return;
  }
  addBranchRecoveryToast({
    type: "error",
    title: isUnresolvedIndexError(error)
      ? "Unresolved conflicts in the repository."
      : input.fallbackTitle,
    description: toBranchActionErrorMessage(error),
    data: { copyText: toBranchActionErrorMessage(error) },
  });
}
