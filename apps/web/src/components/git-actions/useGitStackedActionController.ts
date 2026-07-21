import type {
  GitStatusResult,
  ModelSelection,
  ProviderStartOptions,
  ThreadId,
} from "@agent-group/contracts";
import { useIsMutating, useMutation, type QueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import {
  buildGitActionProgressStages,
  requiresDefaultBranchConfirmation,
  requiresFeatureBranchForDefaultBranchAction,
  resolveCreatePrActionAvailability,
  summarizeGitResult,
} from "../GitActionsControl.logic";
import { toastManager } from "../ui/toast";
import { gitMutationKeys, gitRunStackedActionMutationOptions } from "~/lib/gitReactQuery";
import { newCommandId, randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import type { PendingDefaultBranchAction, RunGitActionWithToastInput } from "./gitActionsTypes";
import { useGitActionProgress } from "./useGitActionProgress";

interface PersistedPullRequest {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
  isDraft?: boolean;
  mergeability?: "mergeable" | "conflicting" | "unknown";
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
}

export function useGitStackedActionController(input: {
  gitCwd: string | null;
  activeThreadId: ThreadId | null;
  gitStatus: GitStatusResult | null;
  isDefaultBranch: boolean;
  hasOriginRemote: boolean;
  defaultBranchName: string | null;
  queryClient: QueryClient;
  codexHomePath: string | null;
  textGenerationModel: string | null;
  modelSelection: ModelSelection;
  providerOptions?: ProviderStartOptions;
  threadToastData: { readonly threadId: ThreadId } | undefined;
}) {
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null);
  const activeProgressRef = useGitActionProgress({
    gitCwd: input.gitCwd,
    threadToastData: input.threadToastData,
  });
  const mutation = useMutation(
    gitRunStackedActionMutationOptions({
      cwd: input.gitCwd,
      queryClient: input.queryClient,
      codexHomePath: input.codexHomePath,
      model: input.textGenerationModel,
      modelSelection: input.modelSelection,
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    }),
  );
  const isRunning =
    useIsMutating({ mutationKey: gitMutationKeys.runStackedAction(input.gitCwd) }) > 0;

  const persistThreadPr = useCallback(
    async (pr: PersistedPullRequest) => {
      if (!input.activeThreadId) return;
      const api = readNativeApi();
      if (!api) return;
      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: input.activeThreadId,
        lastKnownPr: pr,
      });
    },
    [input.activeThreadId],
  );

  const run = useCallback(
    async function runGitActionWithToast({
      action,
      commitMessage,
      forcePushOnlyProgress = false,
      onConfirmed,
      skipDefaultBranchPrompt = false,
      statusOverride,
      featureBranch = false,
      isDefaultBranchOverride,
      progressToastId,
      filePaths,
    }: RunGitActionWithToastInput) {
      const actionStatus = statusOverride ?? input.gitStatus;
      const actionBranch = actionStatus?.branch ?? null;
      const actionIsDefaultBranch =
        isDefaultBranchOverride ?? (featureBranch ? false : input.isDefaultBranch);
      const includesCommit =
        !forcePushOnlyProgress &&
        action !== "push" &&
        action !== "create_pr" &&
        (action === "commit" || !!actionStatus?.hasWorkingTreeChanges);
      const shouldPushBeforePr =
        action === "create_pr" &&
        (!actionStatus?.hasUpstream || (actionStatus?.aheadCount ?? 0) > 0);

      if (
        !skipDefaultBranchPrompt &&
        requiresDefaultBranchConfirmation(action, actionIsDefaultBranch) &&
        actionBranch
      ) {
        setPendingDefaultBranchAction({
          action,
          branchName: actionBranch,
          includesCommit,
          ...(commitMessage ? { commitMessage } : {}),
          forcePushOnlyProgress,
          ...(onConfirmed ? { onConfirmed } : {}),
          ...(filePaths ? { filePaths } : {}),
        });
        return;
      }
      if (action === "create_pr" && !featureBranch) {
        const availability = resolveCreatePrActionAvailability({
          gitStatus: actionStatus,
          isDefaultBranch: actionIsDefaultBranch,
          hasOriginRemote: input.hasOriginRemote,
          defaultBranchName: input.defaultBranchName,
        });
        if (!availability.canRun) {
          toastManager.add({
            type: "info",
            title: "Create PR unavailable",
            description: availability.hint ?? "No branch changes to include in a PR.",
            data: input.threadToastData,
          });
          return;
        }
      }
      onConfirmed?.();

      const progressStages = buildGitActionProgressStages({
        action,
        hasCustomCommitMessage: !!commitMessage?.trim(),
        hasWorkingTreeChanges: !!actionStatus?.hasWorkingTreeChanges,
        forcePushOnly: forcePushOnlyProgress,
        featureBranch,
        shouldPushBeforePr,
      });
      const actionId = randomUUID();
      const resolvedProgressToastId =
        progressToastId ??
        toastManager.add({
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: input.threadToastData,
        });
      activeProgressRef.current = {
        toastId: resolvedProgressToastId,
        actionId,
        title: progressStages[0] ?? "Running git action...",
        phaseStartedAtMs: null,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
        currentPhaseLabel: progressStages[0] ?? "Running git action...",
      };
      if (progressToastId) {
        toastManager.update(progressToastId, {
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: input.threadToastData,
        });
      }

      try {
        const result = await mutation.mutateAsync({
          actionId,
          action,
          ...(commitMessage ? { commitMessage } : {}),
          ...(featureBranch ? { featureBranch } : {}),
          ...(filePaths ? { filePaths } : {}),
        });
        activeProgressRef.current = null;
        const resultToast = summarizeGitResult(result);
        const persistedPr =
          result.pr.status === "created" || result.pr.status === "opened_existing"
            ? result.pr.number &&
              result.pr.title &&
              result.pr.url &&
              result.pr.baseBranch &&
              result.pr.headBranch
              ? {
                  number: result.pr.number,
                  title: result.pr.title,
                  url: result.pr.url,
                  baseBranch: result.pr.baseBranch,
                  headBranch: result.pr.headBranch,
                  state: "open" as const,
                }
              : null
            : actionStatus?.pr?.state === "open"
              ? actionStatus.pr
              : null;
        if (persistedPr) void persistThreadPr(persistedPr).catch(() => undefined);

        const existingOpenPrUrl =
          actionStatus?.pr?.state === "open" ? actionStatus.pr.url : undefined;
        const prUrl = result.pr.url ?? existingOpenPrUrl;
        const shouldOfferPushCta = action === "commit" && result.commit.status === "created";
        const shouldOfferOpenPrCta =
          (action === "push" ||
            action === "create_pr" ||
            action === "commit_push" ||
            action === "commit_push_pr") &&
          !!prUrl &&
          (!actionIsDefaultBranch ||
            result.pr.status === "created" ||
            result.pr.status === "opened_existing");
        const postPushStatus = actionStatus
          ? {
              ...actionStatus,
              hasUpstream: true,
              upstreamBranch:
                actionStatus.upstreamBranch ??
                (!actionStatus.hasUpstream ? (result.push.branch ?? actionStatus.branch) : null),
              aheadCount: 0,
            }
          : null;
        const shouldOfferCreatePrCta =
          (action === "push" || action === "commit_push") &&
          !prUrl &&
          result.push.status === "pushed" &&
          !actionIsDefaultBranch &&
          resolveCreatePrActionAvailability({
            gitStatus: postPushStatus,
            isDefaultBranch: actionIsDefaultBranch,
            hasOriginRemote: input.hasOriginRemote,
            defaultBranchName: input.defaultBranchName,
          }).canRun;
        const closeResultToast = () => toastManager.close(resolvedProgressToastId);

        toastManager.update(resolvedProgressToastId, {
          type: "success",
          title: resultToast.title,
          description: resultToast.description,
          timeout: 0,
          data: { ...input.threadToastData, dismissAfterVisibleMs: 10_000 },
          ...(shouldOfferPushCta
            ? {
                actionProps: {
                  children: "Push",
                  onClick: () => {
                    void runGitActionWithToast({
                      action: "push",
                      onConfirmed: closeResultToast,
                      statusOverride: actionStatus,
                      isDefaultBranchOverride: actionIsDefaultBranch,
                    });
                  },
                },
              }
            : shouldOfferOpenPrCta
              ? {
                  actionProps: {
                    children: "View PR",
                    onClick: () => {
                      const api = readNativeApi();
                      if (!api) return;
                      closeResultToast();
                      void api.shell.openExternal(prUrl);
                    },
                  },
                }
              : shouldOfferCreatePrCta
                ? {
                    actionProps: {
                      children: "Create PR",
                      onClick: () => {
                        closeResultToast();
                        void runGitActionWithToast({
                          action: "create_pr",
                          statusOverride: postPushStatus,
                          isDefaultBranchOverride: actionIsDefaultBranch,
                        });
                      },
                    },
                  }
                : {}),
        });
      } catch (error) {
        activeProgressRef.current = null;
        toastManager.update(resolvedProgressToastId, {
          type: "error",
          title: "Action failed",
          description: error instanceof Error ? error.message : "An error occurred.",
          data: input.threadToastData,
        });
      }
    },
    [
      activeProgressRef,
      input.defaultBranchName,
      input.gitStatus,
      input.hasOriginRemote,
      input.isDefaultBranch,
      input.threadToastData,
      mutation,
      persistThreadPr,
    ],
  );

  const confirmPending = useCallback(
    (featureBranch: boolean) => {
      if (!pendingDefaultBranchAction) return;
      const { action, commitMessage, forcePushOnlyProgress, onConfirmed, filePaths } =
        pendingDefaultBranchAction;
      setPendingDefaultBranchAction(null);
      void run({
        action,
        ...(commitMessage ? { commitMessage } : {}),
        forcePushOnlyProgress,
        ...(onConfirmed ? { onConfirmed } : {}),
        ...(filePaths ? { filePaths } : {}),
        ...(featureBranch ? { featureBranch: true } : {}),
        skipDefaultBranchPrompt: true,
      });
    },
    [pendingDefaultBranchAction, run],
  );

  return {
    abortPending: () => setPendingDefaultBranchAction(null),
    confirmPending: () =>
      confirmPending(
        pendingDefaultBranchAction
          ? requiresFeatureBranchForDefaultBranchAction(pendingDefaultBranchAction.action)
          : false,
      ),
    confirmPendingOnFeatureBranch: () => confirmPending(true),
    isRunning,
    pendingDefaultBranchAction,
    run,
  };
}

export type GitStackedActionController = ReturnType<typeof useGitStackedActionController>;
