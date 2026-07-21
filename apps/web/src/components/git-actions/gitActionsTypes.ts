import type { GitStackedAction, GitStatusResult, ThreadId } from "@agent-group/contracts";

import type { DefaultBranchConfirmableAction, GitActionIconName } from "../GitActionsControl.logic";
import type { toastManager } from "../ui/toast";

export interface GitActionsControlProps {
  gitCwd: string | null;
  activeThreadId: ThreadId | null;
  hideQuickActionLabel?: boolean;
  variant?: "header" | "panel";
}

export interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  commitMessage?: string;
  forcePushOnlyProgress: boolean;
  onConfirmed?: () => void;
  filePaths?: string[];
}

export type GitActionToastId = ReturnType<typeof toastManager.add>;

export interface ActiveGitActionProgress {
  toastId: GitActionToastId;
  actionId: string;
  title: string;
  phaseStartedAtMs: number | null;
  hookStartedAtMs: number | null;
  hookName: string | null;
  lastOutputLine: string | null;
  currentPhaseLabel: string | null;
}

export interface RunGitActionWithToastInput {
  action: GitStackedAction;
  commitMessage?: string;
  forcePushOnlyProgress?: boolean;
  onConfirmed?: () => void;
  skipDefaultBranchPrompt?: boolean;
  statusOverride?: GitStatusResult | null;
  featureBranch?: boolean;
  isDefaultBranchOverride?: boolean;
  progressToastId?: GitActionToastId;
  filePaths?: string[];
}

export interface GitPickerMenuItem {
  id: "push" | "pr" | "sync" | "commit" | "commit_push" | "create_branch";
  label: string;
  disabled: boolean;
  disabledReason: string | null;
  icon: GitActionIconName | "sync" | "branch";
  onSelect: () => void;
}
