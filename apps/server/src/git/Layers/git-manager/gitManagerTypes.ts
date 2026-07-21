import type {
  GitActionProgressEvent,
  ModelSelection,
  ProviderStartOptions,
} from "@agent-group/contracts";
import type { GitHubPullRequestSummary } from "../../Services/GitHubCli.ts";

export type StripProgressContext<T> = T extends any
  ? Omit<T, "actionId" | "cwd" | "action">
  : never;

export type GitActionProgressPayload = StripProgressContext<GitActionProgressEvent>;

export interface PullRequestInfo extends Omit<GitHubPullRequestSummary, "state" | "updatedAt"> {
  readonly state: NonNullable<GitHubPullRequestSummary["state"]>;
  readonly updatedAt: string | null;
}

export interface ResolvedPullRequest {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  mergeability: "mergeable" | "conflicting" | "unknown";
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
}

export interface PullRequestHeadRemoteInfo {
  isCrossRepository?: boolean;
  headRepositoryNameWithOwner?: string | null;
  headRepositoryOwnerLogin?: string | null;
}

export interface BranchHeadContext {
  localBranch: string;
  headBranch: string;
  headSelectors: ReadonlyArray<string>;
  preferredHeadSelector: string;
  remoteName: string | null;
  headRepositoryNameWithOwner: string | null;
  headRepositoryOwnerLogin: string | null;
  isCrossRepository: boolean;
}

export interface GitTextGenerationParams {
  textGenerationModel?: string | undefined;
  textGenerationModelSelection?: ModelSelection | undefined;
  codexHomePath?: string | undefined;
  providerOptions?: ProviderStartOptions | undefined;
}

export interface CommitAndBranchSuggestion {
  subject: string;
  body: string;
  branch?: string | undefined;
  commitMessage: string;
}

export interface FeatureBranchStepOptions {
  allowCommittedHead?: boolean;
  restoreOriginalBranchRef?: string | null;
}

export interface FailedLocalHandoffRecovery {
  worktreeRecreated: boolean;
  worktreeChangesRestored: boolean;
  localChangesRestored: boolean;
  recoveryNotes: ReadonlyArray<string>;
}

export interface FailedLocalTransferRecovery extends FailedLocalHandoffRecovery {
  localCheckoutRestored: boolean;
}

export interface FailedWorktreeHandoffRecovery {
  checkoutRestored: boolean;
  stashRestored: boolean;
  recoveryNotes: ReadonlyArray<string>;
}

export interface FailedWorktreeTransferRecovery extends FailedWorktreeHandoffRecovery {
  worktreeRemoved: boolean;
}
