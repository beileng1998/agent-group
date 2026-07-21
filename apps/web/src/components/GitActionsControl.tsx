import { DEFAULT_GIT_TEXT_GENERATION_MODEL, type ModelSelection } from "@agent-group/contracts";
import { useMemo } from "react";

import { getProviderStartOptions, useAppSettings } from "~/appSettings";
import { invalidateGitQueries } from "~/lib/gitReactQuery";
import {
  requiresFeatureBranchForDefaultBranchAction,
  resolveDefaultBranchActionDialogCopy,
} from "./GitActionsControl.logic";
import { GitActionDialogs, type GitDefaultBranchDialogModel } from "./git-actions/GitActionDialogs";
import { GitActionMenuContent } from "./git-actions/GitActionMenuContent";
import { GitActionHeaderSurface, GitActionPanelSurface } from "./git-actions/GitActionSurfaces";
import type { GitActionsControlProps } from "./git-actions/gitActionsTypes";
import { useGitActionMenuModel } from "./git-actions/useGitActionMenuModel";
import { useGitBranchCreationController } from "./git-actions/useGitBranchCreationController";
import { useGitCommitDialogController } from "./git-actions/useGitCommitDialogController";
import { useGitRemoteActions } from "./git-actions/useGitRemoteActions";
import { useGitRepositoryActionState } from "./git-actions/useGitRepositoryActionState";
import { useGitStackedActionController } from "./git-actions/useGitStackedActionController";

export default function GitActionsControl({
  gitCwd,
  activeThreadId,
  hideQuickActionLabel = false,
  variant = "header",
}: GitActionsControlProps) {
  const { settings } = useAppSettings();
  const providerOptions = useMemo(() => getProviderStartOptions(settings), [settings]);
  const modelSelection = useMemo(
    (): ModelSelection => ({
      provider: settings.textGenerationProvider ?? "codex",
      model: settings.textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL,
    }),
    [settings.textGenerationModel, settings.textGenerationProvider],
  );
  const repository = useGitRepositoryActionState({ gitCwd, activeThreadId });
  const remote = useGitRemoteActions({
    gitCwd,
    gitStatus: repository.gitStatusForActions,
    queryClient: repository.queryClient,
    threadToastData: repository.threadToastData,
  });
  const stacked = useGitStackedActionController({
    gitCwd,
    activeThreadId,
    gitStatus: repository.gitStatusForActions,
    isDefaultBranch: repository.isDefaultBranch,
    hasOriginRemote: repository.hasOriginRemote,
    defaultBranchName: repository.defaultBranchName,
    queryClient: repository.queryClient,
    codexHomePath: settings.codexHomePath || null,
    textGenerationModel: settings.textGenerationModel ?? null,
    modelSelection,
    ...(providerOptions ? { providerOptions } : {}),
    threadToastData: repository.threadToastData,
  });
  const isGitActionRunning = stacked.isRunning || remote.isPullRunning;
  const branch = useGitBranchCreationController({ gitCwd, activeThreadId, repository });
  const commit = useGitCommitDialogController({ gitCwd, repository, stacked });
  const menu = useGitActionMenuModel({
    repository,
    stacked,
    remote,
    isGitActionRunning,
    openCommitDialog: commit.openDialog,
    openCreateBranchDialog: branch.openDialog,
  });
  const pendingAction = stacked.pendingDefaultBranchAction;
  const pendingCopy = pendingAction
    ? resolveDefaultBranchActionDialogCopy({
        action: pendingAction.action,
        branchName: pendingAction.branchName,
        includesCommit: pendingAction.includesCommit,
      })
    : null;
  const defaultBranchDialog: GitDefaultBranchDialogModel = {
    open: pendingAction !== null,
    title: pendingCopy?.title ?? null,
    description: pendingCopy?.description ?? null,
    continueLabel: pendingCopy?.continueLabel ?? null,
    requiresFeatureBranch: pendingAction
      ? requiresFeatureBranchForDefaultBranchAction(pendingAction.action)
      : false,
    onOpenChange: (open) => {
      if (!open) stacked.abortPending();
    },
    onAbort: stacked.abortPending,
    onContinue: stacked.confirmPending,
    onCheckoutFeatureBranch: stacked.confirmPendingOnFeatureBranch,
  };

  if (!gitCwd) return null;

  const onMenuOpen = () => {
    void invalidateGitQueries(repository.queryClient);
  };
  const menuContent = (
    <GitActionMenuContent
      items={menu.items}
      gitStatus={repository.gitStatusForActions}
      isGitStatusOutOfSync={repository.isGitStatusOutOfSync}
      gitStatusError={repository.gitStatusError}
      align={variant === "panel" ? "start" : "end"}
      className={variant === "panel" ? "w-60 min-w-60" : "w-50 min-w-50"}
    />
  );
  const surface =
    variant === "panel" ? (
      <GitActionPanelSurface
        isRepo={repository.isRepo}
        isInitPending={repository.initMutation.isPending}
        onInitialize={() => repository.initMutation.mutate()}
        onMenuOpen={onMenuOpen}
        menuContent={menuContent}
        shouldDimCommitPushRow={menu.shouldDimPanelCommitPushRow}
      />
    ) : (
      <GitActionHeaderSurface
        isRepo={repository.isRepo}
        isInitPending={repository.initMutation.isPending}
        onInitialize={() => repository.initMutation.mutate()}
        onMenuOpen={onMenuOpen}
        menuContent={menuContent}
        quickAction={menu.quickAction}
        quickActionDisabledReason={menu.quickActionDisabledReason}
        hideQuickActionLabel={hideQuickActionLabel}
        isGitActionRunning={isGitActionRunning}
        onRunQuickAction={menu.runQuickAction}
      />
    );

  return (
    <>
      {surface}
      <GitActionDialogs
        commit={commit.dialog}
        defaultBranch={defaultBranchDialog}
        createBranch={branch.dialog}
      />
    </>
  );
}
