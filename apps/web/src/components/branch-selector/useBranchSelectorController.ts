import type { GitBranch } from "@agent-group/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useOptimistic, useState, useTransition } from "react";

import { gitQueryKeys, invalidateGitQueries } from "../../lib/gitReactQuery";
import { readNativeApi } from "../../nativeApi";
import {
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchSelectionTarget,
  shouldSyncLocalThreadBranch,
} from "../BranchToolbar.logic";
import { toastManager } from "../ui/toast";
import { handleCheckoutError } from "./branchSelectorRecovery";
import type {
  BranchToolbarBranchSelectorProps,
  StashDiscardDialogState,
} from "./branchSelectorTypes";
import { toBranchActionErrorMessage } from "./branchSelectorValues";
import { useBranchSelectorReadModel } from "./useBranchSelectorReadModel";
import { useBranchSelectorVirtualList } from "./useBranchSelectorVirtualList";

export function useBranchSelectorController(props: BranchToolbarBranchSelectorProps) {
  const queryClient = useQueryClient();
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const [isCreateBranchDialogOpen, setIsCreateBranchDialogOpen] = useState(false);
  const [createBranchName, setCreateBranchName] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const readModel = useBranchSelectorReadModel({
    activeThreadBranch: props.activeThreadBranch,
    activeWorktreePath: props.activeWorktreePath,
    branchCwd: props.branchCwd,
    branchQuery,
    effectiveEnvMode: props.effectiveEnvMode,
    envLocked: props.envLocked,
    onCheckoutPullRequestRequest: props.onCheckoutPullRequestRequest,
  });
  const [resolvedActiveBranch, setOptimisticBranch] = useOptimistic(
    readModel.canonicalActiveBranch,
    (_currentBranch: string | null, optimisticBranch: string | null) => optimisticBranch,
  );
  const [isBranchActionPending, startBranchActionTransition] = useTransition();
  const [stashDiscardDialog, setStashDiscardDialog] = useState<StashDiscardDialogState | null>(
    null,
  );
  const [isDroppingStash, setIsDroppingStash] = useState(false);

  useEffect(() => {
    if (
      !shouldSyncLocalThreadBranch({
        envMode: props.effectiveEnvMode,
        activeWorktreePath: props.activeWorktreePath,
        activeThreadBranch: props.activeThreadBranch,
        currentGitBranch: readModel.currentGitBranch,
        hasServerThread: props.hasServerThread,
        isBranchActionPending,
      })
    ) {
      return;
    }
    props.onSetThreadWorkspace({ branch: readModel.currentGitBranch, worktreePath: null });
  }, [
    isBranchActionPending,
    props.activeThreadBranch,
    props.activeWorktreePath,
    props.effectiveEnvMode,
    props.hasServerThread,
    props.onSetThreadWorkspace,
    readModel.currentGitBranch,
  ]);

  const runBranchAction = (action: () => Promise<void>) => {
    startBranchActionTransition(async () => {
      await action().catch(() => undefined);
      await invalidateGitQueries(queryClient).catch(() => undefined);
    });
  };

  const openCreateBranchDialog = useCallback(() => {
    setCreateBranchName(
      readModel.canPrefillCreateBranch && !readModel.hasExactBranchMatch
        ? readModel.trimmedBranchQuery
        : "",
    );
    setIsBranchMenuOpen(false);
    setIsCreateBranchDialogOpen(true);
  }, [
    readModel.canPrefillCreateBranch,
    readModel.hasExactBranchMatch,
    readModel.trimmedBranchQuery,
  ]);

  const openStashDiscardDialog = useCallback((input: { cwd: string }) => {
    const api = readNativeApi();
    setStashDiscardDialog({
      cwd: input.cwd,
      error: api ? null : "Native API is unavailable.",
      info: null,
      loading: Boolean(api),
    });
    if (!api) return;
    void api.git.stashInfo({ cwd: input.cwd }).then(
      (info) => {
        setStashDiscardDialog((current) =>
          current?.cwd === input.cwd ? { ...current, error: null, info, loading: false } : current,
        );
      },
      (error) => {
        setStashDiscardDialog((current) =>
          current?.cwd === input.cwd
            ? {
                ...current,
                error: toBranchActionErrorMessage(error),
                info: null,
                loading: false,
              }
            : current,
        );
      },
    );
  }, []);

  const discardStashFromDialog = useCallback(() => {
    const dialog = stashDiscardDialog;
    const api = readNativeApi();
    if (!dialog || !api || isDroppingStash) return;
    setIsDroppingStash(true);
    runBranchAction(async () => {
      try {
        await api.git.stashDrop({ cwd: dialog.cwd });
        setStashDiscardDialog(null);
      } finally {
        setIsDroppingStash(false);
      }
    });
  }, [isDroppingStash, runBranchAction, stashDiscardDialog]);

  const selectBranch = (branch: GitBranch) => {
    const api = readNativeApi();
    const branchCwd = props.branchCwd;
    if (!api || !branchCwd || isBranchActionPending) return;
    if (readModel.isSelectingWorktreeBase) {
      props.onSetThreadWorkspace({ branch: branch.name, worktreePath: null });
      setIsBranchMenuOpen(false);
      props.onComposerFocusRequest?.();
      return;
    }

    const selectionTarget = resolveBranchSelectionTarget({
      activeProjectCwd: props.activeProjectCwd,
      activeWorktreePath: props.activeWorktreePath,
      branch,
    });
    if (selectionTarget.reuseExistingWorktree) {
      props.onSetThreadWorkspace({
        branch: branch.name,
        worktreePath: selectionTarget.nextWorktreePath,
      });
      setIsBranchMenuOpen(false);
      props.onComposerFocusRequest?.();
      return;
    }

    const selectedBranchName = branch.isRemote
      ? deriveLocalBranchNameFromRemoteRef(branch.name)
      : branch.name;
    setIsBranchMenuOpen(false);
    props.onComposerFocusRequest?.();
    runBranchAction(async () => {
      setOptimisticBranch(selectedBranchName);
      try {
        await api.git.checkout({ cwd: selectionTarget.checkoutCwd, branch: branch.name });
        await invalidateGitQueries(queryClient);
      } catch (error) {
        handleCheckoutError(error, {
          api,
          branch: branch.name,
          cwd: selectionTarget.checkoutCwd,
          fallbackTitle: "Failed to checkout branch.",
          onSuccess: () => {
            setOptimisticBranch(selectedBranchName);
            props.onSetThreadWorkspace({
              branch: selectedBranchName,
              worktreePath: selectionTarget.nextWorktreePath,
            });
          },
          queryClient,
          runBranchAction,
          onRequestDiscardStash: openStashDiscardDialog,
        });
        return;
      }

      let nextBranchName = selectedBranchName;
      if (branch.isRemote) {
        const status = await api.git.status({ cwd: branchCwd }).catch(() => null);
        if (status?.branch) nextBranchName = status.branch;
      }
      setOptimisticBranch(nextBranchName);
      props.onSetThreadWorkspace({
        branch: nextBranchName,
        worktreePath: selectionTarget.nextWorktreePath,
      });
    });
  };

  const createBranch = (rawName: string) => {
    const name = rawName.trim();
    const api = readNativeApi();
    const branchCwd = props.branchCwd;
    if (!api || !branchCwd || !name || isBranchActionPending) return;
    setIsBranchMenuOpen(false);
    props.onComposerFocusRequest?.();
    runBranchAction(async () => {
      setOptimisticBranch(name);
      try {
        await api.git.createBranch({
          cwd: branchCwd,
          branch: name,
          publish: readModel.hasOriginRemote,
        });
        try {
          await api.git.checkout({ cwd: branchCwd, branch: name });
        } catch (error) {
          handleCheckoutError(error, {
            api,
            branch: name,
            cwd: branchCwd,
            fallbackTitle: "Failed to checkout branch.",
            onSuccess: () => {
              setOptimisticBranch(name);
              props.onSetThreadWorkspace({
                branch: name,
                worktreePath: props.activeWorktreePath,
              });
              setBranchQuery("");
              setCreateBranchName("");
            },
            queryClient,
            runBranchAction,
            onRequestDiscardStash: openStashDiscardDialog,
          });
          return;
        }
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to create branch.",
          description: toBranchActionErrorMessage(error),
        });
        return;
      }
      setOptimisticBranch(name);
      props.onSetThreadWorkspace({ branch: name, worktreePath: props.activeWorktreePath });
      setBranchQuery("");
      setCreateBranchName("");
    });
  };

  useEffect(() => {
    if (
      props.effectiveEnvMode !== "worktree" ||
      props.activeWorktreePath ||
      props.activeThreadBranch ||
      !readModel.currentGitBranch
    ) {
      return;
    }
    props.onSetThreadWorkspace({ branch: readModel.currentGitBranch, worktreePath: null });
  }, [
    props.activeThreadBranch,
    props.activeWorktreePath,
    props.effectiveEnvMode,
    props.onSetThreadWorkspace,
    readModel.currentGitBranch,
  ]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsBranchMenuOpen(open);
      if (!open) {
        setBranchQuery("");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: gitQueryKeys.branches(props.branchCwd) });
    },
    [props.branchCwd, queryClient],
  );
  const virtualList = useBranchSelectorVirtualList({ isBranchMenuOpen, readModel });

  return {
    branchQuery,
    createBranch,
    createBranchName,
    discardStashFromDialog,
    handleOpenChange,
    isBranchActionPending,
    isBranchMenuOpen,
    isCreateBranchDialogOpen,
    isDroppingStash,
    openCreateBranchDialog,
    readModel,
    resolvedActiveBranch,
    selectBranch,
    setBranchQuery,
    setCreateBranchName,
    setIsCreateBranchDialogOpen,
    setIsDroppingStash,
    setStashDiscardDialog,
    stashDiscardDialog,
    virtualList,
  };
}

export type BranchSelectorController = ReturnType<typeof useBranchSelectorController>;
