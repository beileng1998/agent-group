import type { GitStatusResult } from "@agent-group/contracts";
import {
  CloudSyncIcon,
  GitBranchIcon,
  GitCommitIcon,
  InfoIcon,
  type LucideIcon,
  PushIcon,
} from "~/lib/icons";

import { GitHubIcon } from "../Icons";
import type {
  GitActionIconName,
  GitActionMenuItem,
  GitQuickAction,
} from "../GitActionsControl.logic";
import { MenuItem } from "../ui/menu";
import type { GitPickerMenuItem } from "./gitActionsTypes";

export const COMMIT_DIALOG_TITLE = "Commit changes";
export const COMMIT_DIALOG_DESCRIPTION =
  "Review and confirm your commit. Leave the message blank to auto-generate one.";

const GIT_ACTION_ICON_CLASS = "size-3.5";
export type GitGlyphName = GitActionIconName | "sync" | "branch";

const GIT_ACTION_GLYPH: Record<GitGlyphName, LucideIcon> = {
  commit: GitCommitIcon,
  push: PushIcon,
  pr: GitHubIcon,
  sync: CloudSyncIcon,
  branch: GitBranchIcon,
};

export function GitActionGlyph({ name, className }: { name: GitGlyphName; className?: string }) {
  const Glyph = GIT_ACTION_GLYPH[name];
  return <Glyph className={className ?? GIT_ACTION_ICON_CLASS} />;
}

function resolveGitQuickActionGlyph(quickAction: GitQuickAction): GitGlyphName | null {
  if (quickAction.kind === "open_pr") return "pr";
  if (quickAction.kind === "run_pull") return "sync";
  if (quickAction.kind === "create_branch") return "branch";
  if (quickAction.kind === "run_action") {
    return quickAction.action === "commit" ? "commit" : "push";
  }
  if (quickAction.label === "Commit") return "commit";
  return null;
}

export function GitQuickActionIcon({ quickAction }: { quickAction: GitQuickAction }) {
  const name = resolveGitQuickActionGlyph(quickAction);
  if (name) return <GitActionGlyph name={name} />;
  return <InfoIcon className={GIT_ACTION_ICON_CLASS} />;
}

export function GitPickerMenuRow({ item }: { item: GitPickerMenuItem }) {
  return (
    <MenuItem disabled={item.disabled} onClick={item.onSelect}>
      <span className="inline-flex shrink-0 items-center [&>svg]:size-3.5">
        <GitActionGlyph name={item.icon} />
      </span>
      <span>{item.label}</span>
    </MenuItem>
  );
}

export function getMenuActionDisabledReason({
  item,
  gitStatus,
  isBusy,
  hasOriginRemote,
}: {
  item: GitActionMenuItem;
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  hasOriginRemote: boolean;
}): string | null {
  if (!item.disabled) return null;
  if (isBusy) return "Git action in progress.";
  if (!gitStatus) return "Git status is unavailable.";

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;

  if (item.id === "commit") {
    return !hasChanges
      ? "Worktree is clean. Make changes before committing."
      : "Commit is currently unavailable.";
  }
  if (item.id === "push") {
    if (!hasBranch) return "Detached HEAD: checkout a branch before pushing.";
    if (hasChanges) return "Commit or stash local changes before pushing.";
    if (isBehind) return "Branch is behind upstream. Pull/rebase before pushing.";
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return 'Add an "origin" remote before pushing.';
    }
    if (!isAhead) return "No local commits to push.";
    return "Push is currently unavailable.";
  }
  if (item.id === "commit_push") {
    if (!hasBranch) return "Detached HEAD: checkout a branch before committing and pushing.";
    if (isBehind) {
      return "Branch is behind upstream. Pull/rebase before committing and pushing.";
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return 'Add an "origin" remote before committing and pushing.';
    }
    if (!hasChanges && !isAhead) return "No local changes or commits to push.";
    return "Commit & push is currently unavailable.";
  }
  if (hasOpenPr) return "View PR is currently unavailable.";
  if (!hasBranch) return "Detached HEAD: checkout a branch before creating a PR.";
  if (hasChanges) return "Commit local changes before creating a PR.";
  if (!gitStatus.hasUpstream && !hasOriginRemote) {
    return 'Add an "origin" remote before creating a PR.';
  }
  if (!isAhead) return "No local commits to include in a PR.";
  if (isBehind) return "Branch is behind upstream. Pull/rebase before creating a PR.";
  return "Create PR is currently unavailable.";
}
