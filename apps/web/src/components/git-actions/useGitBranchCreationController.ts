import type { ThreadId } from "@agent-group/contracts";
import { useCallback, useState } from "react";

import { invalidateGitQueries } from "~/lib/gitReactQuery";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "../ui/toast";
import type { GitCreateBranchDialogModel } from "./GitActionDialogs";
import type { GitRepositoryActionState } from "./useGitRepositoryActionState";

export function useGitBranchCreationController(input: {
  gitCwd: string | null;
  activeThreadId: ThreadId | null;
  repository: GitRepositoryActionState;
}) {
  const [open, setOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const normalizedCurrentBranchName =
    input.repository.currentBranchName?.trim().toLowerCase() ?? "";
  const normalizedCreateBranchName = branchName.trim().toLowerCase();
  const branchNameConflicts =
    normalizedCreateBranchName.length > 0 &&
    normalizedCreateBranchName !== normalizedCurrentBranchName &&
    input.repository.branchNames.has(normalizedCreateBranchName);

  const openDialog = useCallback(() => {
    setBranchName(input.repository.suggestedCreateBranchName);
    setOpen(true);
  }, [input.repository.suggestedCreateBranchName]);

  const onOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setOpen(false);
      setBranchName("");
    }
  }, []);

  const createAndCheckout = useCallback(
    async (nextBranchName: string) => {
      const api = readNativeApi();
      if (!api || !input.gitCwd) return;
      const trimmedName = nextBranchName.trim();
      if (!trimmedName) return;

      setOpen(false);
      setBranchName("");
      if (trimmedName.toLowerCase() === normalizedCurrentBranchName) {
        if (input.activeThreadId) {
          void api.orchestration
            .dispatchCommand({
              type: "thread.meta.update",
              commandId: newCommandId(),
              threadId: input.activeThreadId,
              createBranchFlowCompleted: true,
            })
            .catch(() => {
              input.repository.setThreadWorkspaceAction(input.activeThreadId!, {
                createBranchFlowCompleted: false,
              });
            });
          input.repository.setThreadWorkspaceAction(input.activeThreadId, {
            createBranchFlowCompleted: true,
          });
        }
        toastManager.add({
          type: "success",
          title: `Keeping ${trimmedName}`,
          description: "Branch name confirmed.",
          data: input.repository.threadToastData,
        });
        return;
      }

      const toastId = toastManager.add({
        type: "loading",
        title: "Creating branch...",
        timeout: 0,
        data: input.repository.threadToastData,
      });
      try {
        await api.git.createBranch({
          cwd: input.gitCwd,
          branch: trimmedName,
          publish: input.repository.hasOriginRemote,
        });
        await api.git.checkout({ cwd: input.gitCwd, branch: trimmedName });
        if (input.activeThreadId) {
          void api.orchestration
            .dispatchCommand({
              type: "thread.meta.update",
              commandId: newCommandId(),
              threadId: input.activeThreadId,
              branch: trimmedName,
              worktreePath: input.repository.activeThread?.worktreePath ?? null,
              associatedWorktreeBranch: trimmedName,
              associatedWorktreeRef: trimmedName,
              createBranchFlowCompleted: true,
            })
            .catch(() => {
              input.repository.setThreadWorkspaceAction(input.activeThreadId!, {
                createBranchFlowCompleted: false,
              });
            });
          input.repository.setThreadWorkspaceAction(input.activeThreadId, {
            branch: trimmedName,
            associatedWorktreeBranch: trimmedName,
            associatedWorktreeRef: trimmedName,
            createBranchFlowCompleted: true,
          });
        }
        await invalidateGitQueries(input.repository.queryClient);
        toastManager.update(toastId, {
          type: "success",
          title: `Switched to ${trimmedName}`,
          description: "Branch created and checked out.",
          data: input.repository.threadToastData,
        });
      } catch (error) {
        toastManager.update(toastId, {
          type: "error",
          title: "Failed to create branch",
          description: error instanceof Error ? error.message : "An error occurred.",
          data: input.repository.threadToastData,
        });
      }
    },
    [input.activeThreadId, input.gitCwd, input.repository, normalizedCurrentBranchName],
  );

  const dialog: GitCreateBranchDialogModel = {
    open,
    branchName,
    branchNameConflicts,
    onOpenChange,
    onBranchNameChange: setBranchName,
    onSubmit: (name) => void createAndCheckout(name),
  };

  return { dialog, openDialog };
}
