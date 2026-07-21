import type { GitStackedAction, GitStatusResult } from "@agent-group/contracts";

export type GitActionIconName = "commit" | "push" | "pr";
export type GitDialogAction = "commit" | "push" | "commit_push" | "create_pr";

export interface GitActionMenuItem {
  id: "commit" | "commit_push" | "push" | "pr";
  label: string;
  disabled: boolean;
  icon: GitActionIconName;
  kind: "open_dialog" | "open_pr";
  dialogAction?: GitDialogAction;
}

export interface GitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_pr" | "show_hint" | "create_branch";
  action?: GitStackedAction;
  hint?: string;
}

const FALLBACK_DEFAULT_BRANCH_NAMES = new Set(["main", "master"]);
const CREATE_PR_UNAVAILABLE_HINT = "No branch changes to include in a PR.";

function extractTrackedBranchName(upstreamBranch: string | null | undefined): string | null {
  if (!upstreamBranch) return null;
  const branchName = upstreamBranch.trim();
  return branchName.length > 0 ? branchName : null;
}

function tracksDefaultUpstream(
  gitStatus: GitStatusResult,
  defaultBranchName?: string | null,
): boolean {
  const trackedBranchName = extractTrackedBranchName(gitStatus.upstreamBranch);
  if (!trackedBranchName) return false;
  if (defaultBranchName) return trackedBranchName === defaultBranchName;
  return FALLBACK_DEFAULT_BRANCH_NAMES.has(trackedBranchName);
}

function canRunCreatePrAction(input: {
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  isDefaultBranch: boolean;
  hasOriginRemote: boolean;
  defaultBranchName?: string | null | undefined;
}): boolean {
  const { gitStatus, isBusy, isDefaultBranch, hasOriginRemote, defaultBranchName } = input;
  if (!gitStatus) return false;
  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const canPushWithoutUpstream = hasOriginRemote && !gitStatus.hasUpstream;
  const canCreateCleanPublishedPr =
    !isDefaultBranch &&
    gitStatus.hasUpstream &&
    gitStatus.upstreamBranch !== null &&
    !tracksDefaultUpstream(gitStatus, defaultBranchName);
  return (
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !hasOpenPr &&
    !isBehind &&
    (canCreateCleanPublishedPr ||
      (gitStatus.aheadCount > 0 && (gitStatus.hasUpstream || canPushWithoutUpstream)))
  );
}

export function buildMenuItems(
  gitStatus: GitStatusResult | null,
  isBusy: boolean,
  hasOriginRemote = true,
  isDefaultBranch = false,
  defaultBranchName?: string | null,
): GitActionMenuItem[] {
  if (!gitStatus) return [];
  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const canPushWithoutUpstream = hasOriginRemote && !gitStatus.hasUpstream;
  const canCommit = !isBusy && hasChanges;
  const canPush =
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !isBehind &&
    gitStatus.aheadCount > 0 &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCommitPush =
    !isBusy &&
    hasBranch &&
    !isBehind &&
    (hasChanges || gitStatus.aheadCount > 0) &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCreatePr = canRunCreatePrAction({
    gitStatus,
    isBusy,
    isDefaultBranch,
    hasOriginRemote,
    defaultBranchName,
  });
  const canOpenPr = !isBusy && hasOpenPr;
  return [
    {
      id: "commit",
      label: "Commit",
      disabled: !canCommit,
      icon: "commit",
      kind: "open_dialog",
      dialogAction: "commit",
    },
    ...(hasChanges && !isDefaultBranch
      ? [
          {
            id: "commit_push" as const,
            label: "Commit & push",
            disabled: !canCommitPush,
            icon: "push" as const,
            kind: "open_dialog" as const,
            dialogAction: "commit_push" as const,
          },
        ]
      : []),
    {
      id: "push",
      label: isDefaultBranch ? "Commit & push" : "Push",
      disabled: !(isDefaultBranch ? canCommitPush : canPush),
      icon: "push",
      kind: "open_dialog",
      dialogAction: isDefaultBranch ? "commit_push" : "push",
    },
    hasOpenPr
      ? {
          id: "pr",
          label: "Create PR",
          disabled: !canOpenPr,
          icon: "pr",
          kind: "open_pr",
        }
      : {
          id: "pr",
          label: "Create PR",
          disabled: !canCreatePr,
          icon: "pr",
          kind: "open_dialog",
          dialogAction: "create_pr",
        },
  ];
}

export function resolveQuickAction(
  gitStatus: GitStatusResult | null,
  isBusy: boolean,
  isDefaultBranch = false,
  hasOriginRemote = true,
  shouldOfferCreateBranch = false,
  _defaultBranchName?: string | null,
): GitQuickAction {
  if (isBusy) {
    return { label: "Commit", disabled: true, kind: "show_hint", hint: "Git action in progress." };
  }
  if (!gitStatus) {
    return {
      label: "Commit",
      disabled: true,
      kind: "show_hint",
      hint: "Git status is unavailable.",
    };
  }
  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;
  if (!hasBranch) {
    return {
      label: "Commit",
      disabled: true,
      kind: "show_hint",
      hint: "Create and checkout a branch before pushing or opening a PR.",
    };
  }
  if (!gitStatus.hasUpstream && shouldOfferCreateBranch) {
    return { label: "Create Branch", disabled: false, kind: "create_branch" };
  }
  if (gitStatus.hasUpstream) {
    if (isDiverged) {
      return {
        label: "Sync branch",
        disabled: true,
        kind: "show_hint",
        hint: "Branch has diverged from upstream. Rebase/merge first.",
      };
    }
    if (isBehind) return { label: "Pull", disabled: false, kind: "run_pull" };
  }
  if (hasChanges) {
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return { label: "Commit", disabled: false, kind: "run_action", action: "commit" };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: "Commit & push",
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      };
    }
    return {
      label: "Commit, push & PR",
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }
  if (!gitStatus.hasUpstream) {
    if (!hasOriginRemote) {
      if (hasOpenPr && !isAhead) return { label: "View PR", disabled: false, kind: "open_pr" };
      return {
        label: "Push",
        disabled: true,
        kind: "show_hint",
        hint: 'Add an "origin" remote before pushing or creating a PR.',
      };
    }
    if (!isAhead) {
      if (hasOpenPr) return { label: "View PR", disabled: false, kind: "open_pr" };
      return {
        label: "Push",
        disabled: true,
        kind: "show_hint",
        hint: "No local commits to push.",
      };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: isDefaultBranch ? "Commit & push" : "Push",
        disabled: false,
        kind: "run_action",
        action: isDefaultBranch ? "commit_push" : "push",
      };
    }
    return { label: "Push & create PR", disabled: false, kind: "run_action", action: "create_pr" };
  }
  if (isAhead) {
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: isDefaultBranch ? "Commit & push" : "Push",
        disabled: false,
        kind: "run_action",
        action: isDefaultBranch ? "commit_push" : "push",
      };
    }
    return { label: "Push & create PR", disabled: false, kind: "run_action", action: "create_pr" };
  }
  if (hasOpenPr && gitStatus.hasUpstream) {
    return { label: "View PR", disabled: false, kind: "open_pr" };
  }
  return {
    label: "Commit",
    disabled: true,
    kind: "show_hint",
    hint: "Branch is up to date. No action needed.",
  };
}

export function resolveCreatePrActionAvailability(input: {
  gitStatus: GitStatusResult | null;
  isDefaultBranch?: boolean;
  hasOriginRemote?: boolean;
  defaultBranchName?: string | null | undefined;
}): { canRun: boolean; hint: string | null } {
  const canRun = canRunCreatePrAction({
    gitStatus: input.gitStatus,
    isBusy: false,
    isDefaultBranch: input.isDefaultBranch ?? false,
    hasOriginRemote: input.hasOriginRemote ?? true,
    defaultBranchName: input.defaultBranchName,
  });
  return { canRun, hint: canRun ? null : CREATE_PR_UNAVAILABLE_HINT };
}

export function resolvePullActionAvailability(input: {
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
}): { canRun: boolean; hint: string | null } {
  const { gitStatus, isBusy } = input;
  if (isBusy) return { canRun: false, hint: "Git action in progress." };
  if (!gitStatus) return { canRun: false, hint: "Git status is unavailable." };
  if (gitStatus.branch === null) {
    return { canRun: false, hint: "Detached HEAD: checkout a branch before pulling." };
  }
  if (!gitStatus.hasUpstream) {
    return { canRun: false, hint: "Current branch has no upstream to pull from." };
  }
  if (gitStatus.aheadCount > 0 && gitStatus.behindCount > 0) {
    return { canRun: false, hint: "Branch has diverged from upstream. Rebase/merge first." };
  }
  if (gitStatus.behindCount <= 0) {
    return { canRun: false, hint: "Branch is already up to date." };
  }
  return { canRun: true, hint: null };
}

export function shouldOfferCreateBranchPrompt(input: {
  activeWorktreePath: string | null;
  gitStatus: Pick<GitStatusResult, "branch" | "hasUpstream"> | null;
  createBranchFlowCompleted?: boolean;
}): boolean {
  if (!input.activeWorktreePath) return false;
  if (!input.gitStatus?.branch) return false;
  if (input.gitStatus.hasUpstream) return false;
  if (input.createBranchFlowCompleted) return false;
  return true;
}
