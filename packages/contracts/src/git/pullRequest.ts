import { Schema } from "effect";
import { NonNegativeInt, PositiveInt } from "../baseSchemas";
import {
  GitPreparePullRequestThreadMode,
  GitPullRequestMergeability,
  GitPullRequestReference,
  GitPullRequestState,
  TrimmedNonEmptyStringSchema,
} from "./domain";

export const GitResolvedPullRequest = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitPullRequestState,
  isDraft: Schema.Boolean,
  mergeability: GitPullRequestMergeability,
  // Null when `gh` did not report diff sizes, so the UI can hide the stat instead of
  // rendering a misleading "+0 −0".
  additions: Schema.NullOr(NonNegativeInt),
  deletions: Schema.NullOr(NonNegativeInt),
  changedFiles: Schema.NullOr(NonNegativeInt),
});
export type GitResolvedPullRequest = typeof GitResolvedPullRequest.Type;

// Normalized CI check state combining GitHub CheckRun conclusions and commit status states.
export const GitPullRequestCheckStatus = Schema.Literals([
  "pending",
  "success",
  "failure",
  "skipped",
  "neutral",
  "cancelled",
]);
export type GitPullRequestCheckStatus = typeof GitPullRequestCheckStatus.Type;

export const GitPullRequestCheck = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  status: GitPullRequestCheckStatus,
  url: Schema.NullOr(Schema.String),
});
export type GitPullRequestCheck = typeof GitPullRequestCheck.Type;

// Root comment of an unresolved review thread (resolved threads and replies are excluded).
export const GitPullRequestComment = Schema.Struct({
  id: TrimmedNonEmptyStringSchema,
  author: Schema.NullOr(TrimmedNonEmptyStringSchema),
  body: Schema.String,
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
  url: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type GitPullRequestComment = typeof GitPullRequestComment.Type;

export const GitPullRequestRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
});
export type GitPullRequestRefInput = typeof GitPullRequestRefInput.Type;

export const GitPullRequestSnapshotInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
});
export type GitPullRequestSnapshotInput = typeof GitPullRequestSnapshotInput.Type;

export const GitPreparePullRequestThreadInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
  mode: GitPreparePullRequestThreadMode,
});
export type GitPreparePullRequestThreadInput = typeof GitPreparePullRequestThreadInput.Type;

export const GitResolvePullRequestResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
});
export type GitResolvePullRequestResult = typeof GitResolvePullRequestResult.Type;

// Live CI + review-comment snapshot for one PR (drives the Environment panel PR section).
export const GitPullRequestSnapshotResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
  checks: Schema.Array(GitPullRequestCheck),
  comments: Schema.Array(GitPullRequestComment),
  commentsTruncated: Schema.Boolean,
  commentsError: Schema.NullOr(Schema.String),
});
export type GitPullRequestSnapshotResult = typeof GitPullRequestSnapshotResult.Type;

export const GitPreparePullRequestThreadResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
  branch: TrimmedNonEmptyStringSchema,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitPreparePullRequestThreadResult = typeof GitPreparePullRequestThreadResult.Type;
