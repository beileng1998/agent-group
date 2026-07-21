import type {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCreateBranchInput,
  GitCreateDetachedWorktreeInput,
  GitCreateDetachedWorktreeResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitHandoffThreadInput,
  GitHandoffThreadResult,
  GitHubRepositoryInput,
  GitHubRepositoryResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullRequestSnapshotInput,
  GitPullRequestSnapshotResult,
  GitPullResult,
  GitReadWorkingTreeDiffInput,
  GitReadWorkingTreeDiffResult,
  GitRemoveIndexLockInput,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStageFilesInput,
  GitStageFilesResult,
  GitStashAndCheckoutInput,
  GitStashDropInput,
  GitStashInfoInput,
  GitStashInfoResult,
  GitStatusInput,
  GitStatusResult,
  GitSummarizeDiffInput,
  GitSummarizeDiffResult,
  GitUnstageFilesInput,
  GitUnstageFilesResult,
} from "../git";
import type {
  PullRequestActionInput,
  PullRequestActionResult,
  PullRequestCommentInput,
  PullRequestDetail,
  PullRequestDetailInput,
  PullRequestDiffResult,
  PullRequestReviewRequestCountInput,
  PullRequestReviewRequestCountResult,
  PullRequestSetPinnedInput,
  PullRequestSetPinnedResult,
  PullRequestsListInput,
  PullRequestsListResult,
} from "../pullRequests";

export interface NativeApiRepositoryDomains {
  git: {
    // Existing branch/worktree API
    githubRepository: (input: GitHubRepositoryInput) => Promise<GitHubRepositoryResult>;
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    createDetachedWorktree: (
      input: GitCreateDetachedWorktreeInput,
    ) => Promise<GitCreateDetachedWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<void>;
    checkout: (input: GitCheckoutInput) => Promise<void>;
    stashAndCheckout: (input: GitStashAndCheckoutInput) => Promise<void>;
    stashDrop: (input: GitStashDropInput) => Promise<void>;
    stashInfo: (input: GitStashInfoInput) => Promise<GitStashInfoResult>;
    removeIndexLock: (input: GitRemoveIndexLockInput) => Promise<void>;
    init: (input: GitInitInput) => Promise<void>;
    stageFiles: (input: GitStageFilesInput) => Promise<GitStageFilesResult>;
    unstageFiles: (input: GitUnstageFilesInput) => Promise<GitUnstageFilesResult>;
    handoffThread: (input: GitHandoffThreadInput) => Promise<GitHandoffThreadResult>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    pullRequestSnapshot: (
      input: GitPullRequestSnapshotInput,
    ) => Promise<GitPullRequestSnapshotResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    // Stacked action API
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    status: (input: GitStatusInput) => Promise<GitStatusResult>;
    readWorkingTreeDiff: (
      input: GitReadWorkingTreeDiffInput,
    ) => Promise<GitReadWorkingTreeDiffResult>;
    summarizeDiff: (input: GitSummarizeDiffInput) => Promise<GitSummarizeDiffResult>;
    runStackedAction: (input: GitRunStackedActionInput) => Promise<GitRunStackedActionResult>;
    onActionProgress: (callback: (event: GitActionProgressEvent) => void) => () => void;
  };
  pullRequests: {
    list: (input: PullRequestsListInput) => Promise<PullRequestsListResult>;
    reviewRequestCount: (
      input: PullRequestReviewRequestCountInput,
    ) => Promise<PullRequestReviewRequestCountResult>;
    detail: (input: PullRequestDetailInput) => Promise<PullRequestDetail>;
    diff: (input: PullRequestDetailInput) => Promise<PullRequestDiffResult>;
    action: (input: PullRequestActionInput) => Promise<PullRequestActionResult>;
    comment: (input: PullRequestCommentInput) => Promise<PullRequestActionResult>;
    setPinned: (input: PullRequestSetPinnedInput) => Promise<PullRequestSetPinnedResult>;
  };
}
