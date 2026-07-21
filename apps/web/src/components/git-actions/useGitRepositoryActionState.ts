import type { ThreadId } from "@agent-group/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import {
  gitBranchesQueryOptions,
  gitInitMutationOptions,
  gitStatusQueryOptions,
  invalidateGitQueries,
} from "~/lib/gitReactQuery";
import { createThreadSelector } from "~/storeSelectors";
import { useStore } from "~/store";
import {
  resolveDefaultCreateBranchName,
  resolveLiveThreadBranchUpdate,
  shouldOfferCreateBranchPrompt,
} from "../GitActionsControl.logic";

export function useGitRepositoryActionState(input: {
  gitCwd: string | null;
  activeThreadId: ThreadId | null;
}) {
  const queryClient = useQueryClient();
  const activeThread = useStore(
    useMemo(() => createThreadSelector(input.activeThreadId), [input.activeThreadId]),
  );
  const setThreadWorkspaceAction = useStore((store) => store.setThreadWorkspace);
  const threadToastData = useMemo(
    () => (input.activeThreadId ? { threadId: input.activeThreadId } : undefined),
    [input.activeThreadId],
  );
  const { data: gitStatus = null, error: gitStatusError } = useQuery(
    gitStatusQueryOptions(input.gitCwd),
  );
  const { data: branchList = null } = useQuery(gitBranchesQueryOptions(input.gitCwd));
  const initMutation = useMutation(gitInitMutationOptions({ cwd: input.gitCwd, queryClient }));

  const isRepo = branchList?.isRepo ?? true;
  const hasOriginRemote = branchList?.hasOriginRemote ?? false;
  const currentBranch = branchList?.branches.find((branch) => branch.current)?.name ?? null;
  const liveThreadBranchUpdate = useMemo(
    () => resolveLiveThreadBranchUpdate({ threadBranch: currentBranch, gitStatus }),
    [currentBranch, gitStatus],
  );
  const isGitStatusOutOfSync = liveThreadBranchUpdate !== null;

  useEffect(() => {
    if (isGitStatusOutOfSync) void invalidateGitQueries(queryClient);
  }, [isGitStatusOutOfSync, queryClient]);

  const gitStatusForActions = isGitStatusOutOfSync ? null : gitStatus;
  const isDefaultBranch = useMemo(() => {
    const branchName = gitStatusForActions?.branch;
    if (!branchName) return false;
    const current = branchList?.branches.find((branch) => branch.name === branchName);
    return current?.isDefault ?? (branchName === "main" || branchName === "master");
  }, [branchList?.branches, gitStatusForActions?.branch]);
  const defaultBranchName = useMemo(
    () => branchList?.branches.find((branch) => !branch.isRemote && branch.isDefault)?.name ?? null,
    [branchList?.branches],
  );
  const shouldOfferCreateBranch = useMemo(
    () =>
      shouldOfferCreateBranchPrompt({
        activeWorktreePath: activeThread?.worktreePath ?? null,
        gitStatus: gitStatusForActions
          ? {
              branch: gitStatusForActions.branch,
              hasUpstream: gitStatusForActions.hasUpstream,
            }
          : null,
        createBranchFlowCompleted: activeThread?.createBranchFlowCompleted ?? false,
      }),
    [activeThread?.createBranchFlowCompleted, activeThread?.worktreePath, gitStatusForActions],
  );
  const currentBranchName =
    gitStatusForActions?.branch ?? currentBranch ?? activeThread?.branch ?? null;
  const existingBranchNames = useMemo(
    () => (branchList?.branches ?? []).map((branch) => branch.name),
    [branchList?.branches],
  );
  const branchNames = useMemo(
    () => new Set(existingBranchNames.map((branchName) => branchName.toLowerCase())),
    [existingBranchNames],
  );
  const suggestedCreateBranchName = useMemo(
    () =>
      resolveDefaultCreateBranchName(
        existingBranchNames,
        activeThread?.associatedWorktreeBranch ?? activeThread?.title,
      ),
    [activeThread?.associatedWorktreeBranch, activeThread?.title, existingBranchNames],
  );

  return {
    activeThread,
    branchNames,
    currentBranchName,
    defaultBranchName,
    gitStatusError,
    gitStatusForActions,
    hasOriginRemote,
    initMutation,
    isDefaultBranch,
    isGitStatusOutOfSync,
    isRepo,
    queryClient,
    setThreadWorkspaceAction,
    shouldOfferCreateBranch,
    suggestedCreateBranchName,
    threadToastData,
  };
}

export type GitRepositoryActionState = ReturnType<typeof useGitRepositoryActionState>;
