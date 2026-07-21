import { useCallback, useMemo } from "react";

import {
  buildMenuItems,
  type GitActionMenuItem,
  resolvePullActionAvailability,
  resolveQuickAction,
} from "../GitActionsControl.logic";
import { toastManager } from "../ui/toast";
import { getMenuActionDisabledReason } from "./GitActionPresentation";
import type { GitPickerMenuItem } from "./gitActionsTypes";
import type { GitRepositoryActionState } from "./useGitRepositoryActionState";
import type { GitRemoteActions } from "./useGitRemoteActions";
import type { GitStackedActionController } from "./useGitStackedActionController";

export function useGitActionMenuModel(input: {
  repository: GitRepositoryActionState;
  stacked: GitStackedActionController;
  remote: GitRemoteActions;
  isGitActionRunning: boolean;
  openCommitDialog: () => void;
  openCreateBranchDialog: () => void;
}) {
  const quickAction = useMemo(
    () =>
      resolveQuickAction(
        input.repository.gitStatusForActions,
        input.isGitActionRunning,
        input.repository.isDefaultBranch,
        input.repository.hasOriginRemote,
        input.repository.shouldOfferCreateBranch,
        input.repository.defaultBranchName,
      ),
    [input.isGitActionRunning, input.repository],
  );
  const baseMenuItems = useMemo(
    () =>
      buildMenuItems(
        input.repository.gitStatusForActions,
        input.isGitActionRunning,
        input.repository.hasOriginRemote,
        input.repository.isDefaultBranch,
        input.repository.defaultBranchName,
      ),
    [input.isGitActionRunning, input.repository],
  );
  const quickActionDisabledReason = quickAction.disabled
    ? (quickAction.hint ?? "This action is currently unavailable.")
    : null;

  const runQuickAction = useCallback(() => {
    if (quickAction.kind === "open_pr") {
      void input.remote.openExistingPr();
      return;
    }
    if (quickAction.kind === "run_pull") {
      input.remote.runSyncWithRemote();
      return;
    }
    if (quickAction.kind === "create_branch") {
      input.openCreateBranchDialog();
      return;
    }
    if (quickAction.kind === "show_hint") {
      toastManager.add({
        type: "info",
        title: quickAction.label,
        description: quickAction.hint,
        data: input.repository.threadToastData,
      });
      return;
    }
    if (quickAction.action) void input.stacked.run({ action: quickAction.action });
  }, [input, quickAction]);

  const openMenuItem = useCallback(
    (item: GitActionMenuItem) => {
      if (item.disabled) return;
      if (item.kind === "open_pr") {
        void input.remote.openExistingPr();
        return;
      }
      if (item.dialogAction === "push") {
        void input.stacked.run({ action: "push" });
        return;
      }
      if (item.dialogAction === "commit_push") {
        void input.stacked.run({ action: "commit_push" });
        return;
      }
      if (item.dialogAction === "create_pr") {
        void input.stacked.run({ action: "create_pr" });
        return;
      }
      input.openCommitDialog();
    },
    [input],
  );

  const items = useMemo<GitPickerMenuItem[]>(() => {
    const nextItems: GitPickerMenuItem[] = [];
    const commit = baseMenuItems.find((item) => item.id === "commit");
    const commitPush = baseMenuItems.find((item) => item.id === "commit_push");
    const push = baseMenuItems.find((item) => item.id === "push");
    const pr = baseMenuItems.find((item) => item.id === "pr");
    const createBranchDisabled = input.isGitActionRunning || !input.repository.gitStatusForActions;
    const pullAvailability = resolvePullActionAvailability({
      gitStatus: input.repository.gitStatusForActions,
      isBusy: input.isGitActionRunning,
    });
    const addBaseItem = (
      item: GitActionMenuItem | undefined,
      id: GitPickerMenuItem["id"],
      icon: GitPickerMenuItem["icon"],
    ) => {
      if (!item) return;
      nextItems.push({
        id,
        label: item.label,
        disabled: item.disabled,
        disabledReason: getMenuActionDisabledReason({
          item,
          gitStatus: input.repository.gitStatusForActions,
          isBusy: input.isGitActionRunning,
          hasOriginRemote: input.repository.hasOriginRemote,
        }),
        icon,
        onSelect: () => openMenuItem(item),
      });
    };

    addBaseItem(commit, "commit", "commit");
    addBaseItem(commitPush, "commit_push", "push");
    nextItems.push({
      id: "sync",
      label: "Pull",
      disabled: !pullAvailability.canRun,
      disabledReason: pullAvailability.hint,
      icon: "sync",
      onSelect: input.remote.runSyncWithRemote,
    });
    addBaseItem(push, "push", "push");
    addBaseItem(pr, "pr", "pr");
    nextItems.push({
      id: "create_branch",
      label: "Create Branch",
      disabled: createBranchDisabled,
      disabledReason: createBranchDisabled
        ? input.isGitActionRunning
          ? "Git action in progress."
          : "Git status is unavailable."
        : null,
      icon: "branch",
      onSelect: input.openCreateBranchDialog,
    });
    return nextItems;
  }, [baseMenuItems, input, openMenuItem]);

  const hasRunnableCommitPushAction = baseMenuItems.some(
    (item) => (item.id === "commit_push" || item.id === "push") && !item.disabled,
  );

  return {
    items,
    quickAction,
    quickActionDisabledReason,
    runQuickAction,
    shouldDimPanelCommitPushRow: input.isGitActionRunning || !hasRunnableCommitPushAction,
  };
}
