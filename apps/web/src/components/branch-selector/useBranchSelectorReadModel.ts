import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo } from "react";

import { gitBranchesQueryOptions, gitStatusQueryOptions } from "../../lib/gitReactQuery";
import { parsePullRequestReference } from "../../pullRequestReference";
import {
  dedupeRemoteBranchesWithLocalMatches,
  resolveBranchToolbarValue,
} from "../BranchToolbar.logic";
import type { BranchToolbarBranchSelectorProps } from "./branchSelectorTypes";

interface BranchSelectorReadModelInput {
  activeThreadBranch: BranchToolbarBranchSelectorProps["activeThreadBranch"];
  activeWorktreePath: BranchToolbarBranchSelectorProps["activeWorktreePath"];
  branchCwd: BranchToolbarBranchSelectorProps["branchCwd"];
  branchQuery: string;
  effectiveEnvMode: BranchToolbarBranchSelectorProps["effectiveEnvMode"];
  envLocked: BranchToolbarBranchSelectorProps["envLocked"];
  onCheckoutPullRequestRequest: BranchToolbarBranchSelectorProps["onCheckoutPullRequestRequest"];
}

export function useBranchSelectorReadModel(input: BranchSelectorReadModelInput) {
  const deferredBranchQuery = useDeferredValue(input.branchQuery);
  const branchesQuery = useQuery(gitBranchesQueryOptions(input.branchCwd));
  const branchStatusQuery = useQuery(gitStatusQueryOptions(input.branchCwd));
  const branches = useMemo(
    () => dedupeRemoteBranchesWithLocalMatches(branchesQuery.data?.branches ?? []),
    [branchesQuery.data?.branches],
  );
  const currentGitBranch =
    branchStatusQuery.data?.branch ?? branches.find((branch) => branch.current)?.name ?? null;
  const canonicalActiveBranch = resolveBranchToolbarValue({
    envMode: input.effectiveEnvMode,
    activeWorktreePath: input.activeWorktreePath,
    activeThreadBranch: input.activeThreadBranch,
    currentGitBranch,
  });
  const branchNames = useMemo(() => branches.map((branch) => branch.name), [branches]);
  const branchByName = useMemo(
    () => new Map(branches.map((branch) => [branch.name, branch] as const)),
    [branches],
  );
  const trimmedBranchQuery = input.branchQuery.trim();
  const normalizedDeferredBranchQuery = deferredBranchQuery.trim().toLowerCase();
  const prReference = parsePullRequestReference(trimmedBranchQuery);
  const isSelectingWorktreeBase =
    input.effectiveEnvMode === "worktree" && !input.envLocked && !input.activeWorktreePath;
  const checkoutPullRequestItemValue =
    prReference && input.onCheckoutPullRequestRequest
      ? `__checkout_pull_request__:${prReference}`
      : null;
  const canPrefillCreateBranch = !isSelectingWorktreeBase && trimmedBranchQuery.length > 0;
  const hasExactBranchMatch = branchByName.has(trimmedBranchQuery);
  const branchPickerItems = useMemo(() => {
    const items = [...branchNames];
    if (checkoutPullRequestItemValue) items.unshift(checkoutPullRequestItemValue);
    return items;
  }, [branchNames, checkoutPullRequestItemValue]);
  const filteredBranchPickerItems = useMemo(
    () =>
      normalizedDeferredBranchQuery.length === 0
        ? branchPickerItems
        : branchPickerItems.filter((itemValue) =>
            itemValue.toLowerCase().includes(normalizedDeferredBranchQuery),
          ),
    [branchPickerItems, normalizedDeferredBranchQuery],
  );

  return {
    branchByName,
    branches,
    branchesQuery,
    branchStatusQuery,
    branchPickerItems,
    canPrefillCreateBranch,
    canonicalActiveBranch,
    checkoutPullRequestItemValue,
    currentGitBranch,
    filteredBranchPickerItems,
    hasExactBranchMatch,
    hasOriginRemote: branchesQuery.data?.hasOriginRemote ?? false,
    isSelectingWorktreeBase,
    prReference,
    shouldVirtualizeBranchList: filteredBranchPickerItems.length > 40,
    trimmedBranchQuery,
  };
}

export type BranchSelectorReadModel = ReturnType<typeof useBranchSelectorReadModel>;
