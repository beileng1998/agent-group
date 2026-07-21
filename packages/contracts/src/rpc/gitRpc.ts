import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import {
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
import {
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
  PullRequestsUnavailableError,
} from "../pullRequests";
import { WS_METHODS } from "../ws";
import { WsRpcError } from "./errors";

export const WsGitStatusRpc = Rpc.make(WS_METHODS.gitStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: WsRpcError,
});

export const WsGitGithubRepositoryRpc = Rpc.make(WS_METHODS.gitGithubRepository, {
  payload: GitHubRepositoryInput,
  success: GitHubRepositoryResult,
  error: WsRpcError,
});

export const WsGitReadWorkingTreeDiffRpc = Rpc.make(WS_METHODS.gitReadWorkingTreeDiff, {
  payload: GitReadWorkingTreeDiffInput,
  success: GitReadWorkingTreeDiffResult,
  error: WsRpcError,
});

export const WsGitSummarizeDiffRpc = Rpc.make(WS_METHODS.gitSummarizeDiff, {
  payload: GitSummarizeDiffInput,
  success: GitSummarizeDiffResult,
  error: WsRpcError,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: WsRpcError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: WsRpcError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: WsRpcError,
});

export const WsGitPullRequestSnapshotRpc = Rpc.make(WS_METHODS.gitPullRequestSnapshot, {
  payload: GitPullRequestSnapshotInput,
  success: GitPullRequestSnapshotResult,
  error: WsRpcError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: WsRpcError,
});

const PullRequestsRpcError = Schema.Union([PullRequestsUnavailableError, WsRpcError]);

export const WsPullRequestsListRpc = Rpc.make(WS_METHODS.pullRequestsList, {
  payload: PullRequestsListInput,
  success: PullRequestsListResult,
  error: PullRequestsRpcError,
});

export const WsPullRequestsReviewRequestCountRpc = Rpc.make(
  WS_METHODS.pullRequestsReviewRequestCount,
  {
    payload: PullRequestReviewRequestCountInput,
    success: PullRequestReviewRequestCountResult,
    error: PullRequestsRpcError,
  },
);

export const WsPullRequestsDetailRpc = Rpc.make(WS_METHODS.pullRequestsDetail, {
  payload: PullRequestDetailInput,
  success: PullRequestDetail,
  error: PullRequestsRpcError,
});

export const WsPullRequestsDiffRpc = Rpc.make(WS_METHODS.pullRequestsDiff, {
  payload: PullRequestDetailInput,
  success: PullRequestDiffResult,
  error: PullRequestsRpcError,
});

export const WsPullRequestsActionRpc = Rpc.make(WS_METHODS.pullRequestsAction, {
  payload: PullRequestActionInput,
  success: PullRequestActionResult,
  error: PullRequestsRpcError,
});

// Comments reuse the action acknowledgment shape: the mutation is confirmed independently of
// the follow-up detail refetch that surfaces the new comment.
export const WsPullRequestsCommentRpc = Rpc.make(WS_METHODS.pullRequestsComment, {
  payload: PullRequestCommentInput,
  success: PullRequestActionResult,
  error: PullRequestsRpcError,
});

export const WsPullRequestsSetPinnedRpc = Rpc.make(WS_METHODS.pullRequestsSetPinned, {
  payload: PullRequestSetPinnedInput,
  success: PullRequestSetPinnedResult,
  error: WsRpcError,
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: WsRpcError,
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: WsRpcError,
});

export const WsGitCreateDetachedWorktreeRpc = Rpc.make(WS_METHODS.gitCreateDetachedWorktree, {
  payload: GitCreateDetachedWorktreeInput,
  success: GitCreateDetachedWorktreeResult,
  error: WsRpcError,
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashAndCheckoutRpc = Rpc.make(WS_METHODS.gitStashAndCheckout, {
  payload: GitStashAndCheckoutInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashDropRpc = Rpc.make(WS_METHODS.gitStashDrop, {
  payload: GitStashDropInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashInfoRpc = Rpc.make(WS_METHODS.gitStashInfo, {
  payload: GitStashInfoInput,
  success: GitStashInfoResult,
  error: WsRpcError,
});

export const WsGitRemoveIndexLockRpc = Rpc.make(WS_METHODS.gitRemoveIndexLock, {
  payload: GitRemoveIndexLockInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStageFilesRpc = Rpc.make(WS_METHODS.gitStageFiles, {
  payload: GitStageFilesInput,
  success: GitStageFilesResult,
  error: WsRpcError,
});

export const WsGitUnstageFilesRpc = Rpc.make(WS_METHODS.gitUnstageFiles, {
  payload: GitUnstageFilesInput,
  success: GitUnstageFilesResult,
  error: WsRpcError,
});

export const WsGitHandoffThreadRpc = Rpc.make(WS_METHODS.gitHandoffThread, {
  payload: GitHandoffThreadInput,
  success: GitHandoffThreadResult,
  error: WsRpcError,
});
