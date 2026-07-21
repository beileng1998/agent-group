import type { GitStashInfoResult } from "@agent-group/contracts";

import type { EnvMode } from "../BranchToolbar.logic";
import type { ThreadWorkspacePatch } from "../../types";

export type BranchSelectorVariant = "toolbar" | "panel";

export interface BranchToolbarBranchSelectorProps {
  activeProjectCwd: string;
  activeThreadBranch: string | null;
  activeWorktreePath: string | null;
  branchCwd: string | null;
  effectiveEnvMode: EnvMode;
  envLocked: boolean;
  hasServerThread: boolean;
  onSetThreadWorkspace: (patch: ThreadWorkspacePatch) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
  variant?: BranchSelectorVariant;
}

export type StashDiscardDialogState = {
  cwd: string;
  error: string | null;
  info: GitStashInfoResult | null;
  loading: boolean;
};
