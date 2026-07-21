import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "@agent-group/contracts";

export const PULL_REQUEST_LIST_JSON_FIELDS =
  "number,title,url,author,headRefName,baseRefName,state,isDraft,additions,deletions,updatedAt,createdAt,reviewDecision,reviewRequests,labels,mergedAt,mergeable";
export const PULL_REQUEST_DETAIL_JSON_FIELDS =
  "number,title,body,url,author,state,isDraft,mergeable,mergeStateStatus,additions,deletions,changedFiles,headRefName,baseRefName,reviewDecision,reviewRequests,reviews,comments,statusCheckRollup,commits,labels,maintainerCanModify,createdAt,updatedAt,mergedAt,closedAt";

export const RawGitHubPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  isDraft: Schema.optional(Schema.NullOr(Schema.Boolean)),
  mergeable: Schema.optional(Schema.NullOr(Schema.String)),
  additions: Schema.optional(Schema.NullOr(Schema.Number)),
  deletions: Schema.optional(Schema.NullOr(Schema.Number)),
  changedFiles: Schema.optional(Schema.NullOr(Schema.Number)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepository: Schema.optional(Schema.NullOr(Schema.Struct({ nameWithOwner: Schema.String }))),
  headRepositoryOwner: Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

export const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

export const RawStatusCheckRollupItemSchema = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  context: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  detailsUrl: Schema.optional(Schema.NullOr(Schema.String)),
  targetUrl: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  completedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

export const RawPullRequestChecksSchema = Schema.Struct({
  statusCheckRollup: Schema.optional(Schema.NullOr(Schema.Array(RawStatusCheckRollupItemSchema))),
});

export const RawActorSchema = Schema.Struct({
  __typename: Schema.optional(Schema.NullOr(Schema.String)),
  login: Schema.optional(TrimmedNonEmptyString),
  slug: Schema.optional(TrimmedNonEmptyString),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
});

export const RawLabelSchema = Schema.Struct({
  name: TrimmedNonEmptyString,
  color: Schema.optional(Schema.NullOr(Schema.String)),
});

export const RawReviewSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  submittedAt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  author: Schema.optional(Schema.NullOr(RawActorSchema)),
});

export const RawIssueCommentSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  author: Schema.optional(Schema.NullOr(RawActorSchema)),
});

export const RawCommitSchema = Schema.Struct({
  oid: TrimmedNonEmptyString,
  messageHeadline: Schema.optional(Schema.NullOr(Schema.String)),
  messageBody: Schema.optional(Schema.NullOr(Schema.String)),
  committedDate: TrimmedNonEmptyString,
  authors: Schema.optional(Schema.NullOr(Schema.Array(RawActorSchema))),
});

export const RawRepositoryMergeCapabilitiesSchema = Schema.Struct({
  mergeCommitAllowed: Schema.Boolean,
  squashMergeAllowed: Schema.Boolean,
  rebaseMergeAllowed: Schema.Boolean,
  deleteBranchOnMerge: Schema.Boolean,
});

export const RawPullRequestListItemSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  author: Schema.optional(Schema.NullOr(RawActorSchema)),
  headRefName: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  isDraft: Schema.optional(Schema.NullOr(Schema.Boolean)),
  additions: Schema.optional(Schema.NullOr(Schema.Number)),
  deletions: Schema.optional(Schema.NullOr(Schema.Number)),
  createdAt: TrimmedNonEmptyString,
  updatedAt: TrimmedNonEmptyString,
  reviewDecision: Schema.optional(Schema.NullOr(Schema.String)),
  reviewRequests: Schema.optional(Schema.NullOr(Schema.Array(RawActorSchema))),
  reviews: Schema.optional(Schema.NullOr(Schema.Array(RawReviewSchema))),
  labels: Schema.optional(Schema.NullOr(Schema.Array(RawLabelSchema))),
  mergeable: Schema.optional(Schema.NullOr(Schema.String)),
});

export const RawPullRequestNumberSchema = Schema.Struct({ number: PositiveInt });

export const RawPullRequestDetailSchema = Schema.Struct({
  ...RawPullRequestListItemSchema.fields,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  mergeable: Schema.optional(Schema.NullOr(Schema.String)),
  mergeStateStatus: Schema.optional(Schema.NullOr(Schema.String)),
  changedFiles: Schema.optional(Schema.NullOr(Schema.Number)),
  comments: Schema.optional(Schema.NullOr(Schema.Array(RawIssueCommentSchema))),
  statusCheckRollup: Schema.optional(Schema.NullOr(Schema.Array(RawStatusCheckRollupItemSchema))),
  commits: Schema.optional(Schema.NullOr(Schema.Array(RawCommitSchema))),
  maintainerCanModify: Schema.optional(Schema.NullOr(Schema.Boolean)),
  closedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

export const RawGitHubPullRequestWithChecksSchema = Schema.Struct({
  ...RawGitHubPullRequestSchema.fields,
  ...RawPullRequestChecksSchema.fields,
});

export const PULL_REQUEST_REVIEW_THREAD_PAGE_SIZE = 50;
export const PULL_REQUEST_REVIEW_THREAD_PAGE_LIMIT = 5;
export const PULL_REQUEST_REVIEW_COMMENT_LIMIT = 20;

export const PULL_REQUEST_REVIEW_THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: $first, after: $after) {
        nodes {
          isResolved
          comments(first: 1) {
            nodes {
              id
              body
              path
              url
              createdAt
              author { login }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

const RawGraphQlErrorSchema = Schema.Struct({
  message: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawReviewThreadCommentSchema = Schema.Struct({
  id: TrimmedNonEmptyString,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
  author: Schema.optional(
    Schema.NullOr(Schema.Struct({ login: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
});

const RawReviewThreadSchema = Schema.Struct({
  isResolved: Schema.optional(Schema.NullOr(Schema.Boolean)),
  comments: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nodes: Schema.optional(
          Schema.NullOr(Schema.Array(Schema.NullOr(RawReviewThreadCommentSchema))),
        ),
      }),
    ),
  ),
});

export const RawReviewThreadsResponseSchema = Schema.Struct({
  errors: Schema.optional(Schema.NullOr(Schema.Array(Schema.NullOr(RawGraphQlErrorSchema)))),
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              pullRequest: Schema.optional(
                Schema.NullOr(
                  Schema.Struct({
                    reviewThreads: Schema.optional(
                      Schema.NullOr(
                        Schema.Struct({
                          nodes: Schema.optional(
                            Schema.NullOr(Schema.Array(Schema.NullOr(RawReviewThreadSchema))),
                          ),
                          pageInfo: Schema.optional(
                            Schema.NullOr(
                              Schema.Struct({
                                hasNextPage: Schema.optional(Schema.NullOr(Schema.Boolean)),
                                endCursor: Schema.optional(Schema.NullOr(Schema.String)),
                              }),
                            ),
                          ),
                        }),
                      ),
                    ),
                  }),
                ),
              ),
            }),
          ),
        ),
      }),
    ),
  ),
});
