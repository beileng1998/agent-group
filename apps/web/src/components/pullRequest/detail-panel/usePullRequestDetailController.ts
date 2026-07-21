import type {
  PullRequestAction,
  PullRequestDetailInput,
  PullRequestMergeMethod,
} from "@agent-group/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useAppSettings } from "~/appSettings";
import {
  buildFixFindingsPrompt,
  buildResolveConflictsPrompt,
} from "~/components/chat/environment/environmentPullRequest.logic";
import { toastManager } from "~/components/ui/toast";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { appendComposerPromptText } from "~/lib/chatReferences";
import { gitPreparePullRequestThreadMutationOptions } from "~/lib/gitReactQuery";
import {
  pullRequestActionMutationOptions,
  pullRequestDetailQueryOptions,
  pullRequestQueryErrorState,
} from "~/lib/pullRequestReactQuery";

export type PullRequestDetailTab = "summary" | "timeline" | "code";

const ACTION_SUCCESS_LABELS: Record<PullRequestAction, string> = {
  merge: "Pull request merged",
  ready: "Marked ready for review",
  draft: "Converted to draft",
  close: "Pull request closed",
  reopen: "Pull request reopened",
};

export function usePullRequestDetailController({
  input,
  initialTab,
  pollingEnabled,
}: {
  input: PullRequestDetailInput;
  initialTab: PullRequestDetailTab;
  pollingEnabled: boolean;
}) {
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const { handleNewThread } = useHandleNewThread();
  const [tab, setTab] = useState<PullRequestDetailTab>(initialTab);
  const [mergeMethod, setMergeMethod] = useState<PullRequestMergeMethod>("merge");
  const [confirmAction, setConfirmAction] = useState<"merge" | "close" | null>(null);
  const [preparingThread, setPreparingThread] = useState<"findings" | "conflicts" | null>(null);
  const actionInFlightRef = useRef(false);
  const detailQuery = useQuery(pullRequestDetailQueryOptions(input, { pollingEnabled }));
  const actionMutation = useMutation(pullRequestActionMutationOptions(queryClient));
  const detail = detailQuery.data;
  const detailErrorState = pullRequestQueryErrorState(detailQuery);
  const prepareThreadMutation = useMutation(
    gitPreparePullRequestThreadMutationOptions({
      cwd: detail?.workspaceRoot ?? null,
      queryClient,
    }),
  );

  useEffect(() => {
    setTab(initialTab);
    setMergeMethod("merge");
    setConfirmAction(null);
  }, [initialTab, input.number, input.projectId, input.repository]);

  const runAction = async (action: PullRequestAction, method?: PullRequestMergeMethod) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    try {
      await actionMutation.mutateAsync({
        ...input,
        action,
        ...(method ? { mergeMethod: method } : {}),
      });
      toastManager.add({ type: "success", title: ACTION_SUCCESS_LABELS[action] });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Pull request action failed",
        description: error instanceof Error ? error.message : "GitHub CLI action failed.",
      });
    } finally {
      actionInFlightRef.current = false;
    }
  };

  const startPullRequestThread = async (
    kind: "findings" | "conflicts",
    prompt: string,
    errorTitle: string,
  ) => {
    if (!detail || preparingThread !== null) return;
    setPreparingThread(kind);
    try {
      const mode = settings.defaultThreadEnvMode;
      const prepared = await prepareThreadMutation.mutateAsync({ reference: detail.url, mode });
      const threadId = await handleNewThread(detail.projectId, {
        branch: prepared.branch,
        worktreePath: prepared.worktreePath,
        envMode: mode,
        fresh: true,
      });
      if (!threadId) throw new Error("Could not create a draft thread for this pull request.");
      appendComposerPromptText(threadId, prompt);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: errorTitle,
        description:
          error instanceof Error ? error.message : "The PR thread could not be prepared.",
      });
    } finally {
      setPreparingThread(null);
    }
  };

  const fixFindings = () => {
    if (!detail) return;
    void startPullRequestThread(
      "findings",
      buildFixFindingsPrompt({
        prNumber: detail.number,
        prTitle: detail.title,
        prUrl: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        comments: detail.comments,
        checks: detail.checks,
        commentsTruncated: detail.commentsTruncated,
        commentsIncomplete: detail.commentsIncomplete,
      }),
      "Could not prepare findings",
    );
  };

  const resolveConflicts = () => {
    if (!detail) return;
    void startPullRequestThread(
      "conflicts",
      buildResolveConflictsPrompt({
        prNumber: detail.number,
        prUrl: detail.url,
        baseBranch: detail.baseBranch,
        headBranch: detail.headBranch,
      }),
      "Could not prepare conflict resolution",
    );
  };

  const copyPullRequestLink = async () => {
    if (!detail) return;
    try {
      await copyTextToClipboard(detail.url);
      toastManager.add({ type: "success", title: "Pull request link copied" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not copy pull request link",
        description: error instanceof Error ? error.message : "Clipboard access failed.",
      });
    }
  };

  const allowedMethods = detail
    ? (["merge", "squash", "rebase"] as const).filter((method) => detail.mergeCapabilities[method])
    : [];
  const selectedMergeMethod = allowedMethods.includes(mergeMethod)
    ? mergeMethod
    : (allowedMethods[0] ?? "merge");
  const pendingAction = actionMutation.isPending
    ? (actionMutation.variables?.action ?? null)
    : null;

  return {
    input,
    tab,
    setTab,
    detail,
    detailQuery,
    detailErrorState,
    actionPending: actionMutation.isPending,
    pendingAction,
    preparingThread,
    allowedMethods,
    selectedMergeMethod,
    setMergeMethod,
    confirmAction,
    setConfirmAction,
    runAction,
    fixFindings,
    resolveConflicts,
    copyPullRequestLink,
  };
}

export type PullRequestDetailController = ReturnType<typeof usePullRequestDetailController>;
