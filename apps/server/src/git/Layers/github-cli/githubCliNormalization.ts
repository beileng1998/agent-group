import { Effect, Schema } from "effect";
import type {
  GitPullRequestCheck,
  GitPullRequestCheckStatus,
  PullRequestActor,
  PullRequestCheck,
  PullRequestComment,
  PullRequestCommit,
  PullRequestLabel,
} from "@agent-group/contracts";
import { githubAvatarUrlForLogin } from "@agent-group/shared/githubAvatar";

import { GitHubCliError } from "../../Errors.ts";
import type {
  GitHubRepositoryCloneUrls,
  GitHubPullRequestDetailData,
  GitHubPullRequestListBatch,
  GitHubPullRequestListItem,
  GitHubPullRequestSummary,
} from "../../Services/GitHubCli.ts";
import {
  RawActorSchema,
  RawGitHubPullRequestSchema,
  RawGitHubRepositoryCloneUrlsSchema,
  RawLabelSchema,
  RawPullRequestChecksSchema,
  RawPullRequestDetailSchema,
  RawPullRequestListItemSchema,
  RawStatusCheckRollupItemSchema,
} from "./githubCliSchemas.ts";

function normalizePullRequestMergeability(
  mergeable: string | null | undefined,
): "mergeable" | "conflicting" | "unknown" {
  switch (mergeable) {
    case "MERGEABLE":
      return "mergeable";
    case "CONFLICTING":
      return "conflicting";
    default:
      return "unknown";
  }
}

function normalizeDiffCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizePullRequestState(input: {
  state?: string | null | undefined;
  mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const mergedAt = input.mergedAt;
  const state = input.state;
  if ((typeof mergedAt === "string" && mergedAt.trim().length > 0) || state === "MERGED") {
    return "merged";
  }
  if (state === "CLOSED") return "closed";
  return "open";
}

export function normalizePullRequestSummary(
  raw: Schema.Schema.Type<typeof RawGitHubPullRequestSchema>,
): GitHubPullRequestSummary {
  const headRepositoryNameWithOwner = raw.headRepository?.nameWithOwner ?? null;
  const headRepositoryOwnerLogin =
    raw.headRepositoryOwner?.login ??
    (typeof headRepositoryNameWithOwner === "string" && headRepositoryNameWithOwner.includes("/")
      ? (headRepositoryNameWithOwner.split("/")[0] ?? null)
      : null);
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state: normalizePullRequestState(raw),
    isDraft: raw.isDraft === true,
    mergeability: normalizePullRequestMergeability(raw.mergeable),
    additions: normalizeDiffCount(raw.additions),
    deletions: normalizeDiffCount(raw.deletions),
    changedFiles: normalizeDiffCount(raw.changedFiles),
    updatedAt: raw.updatedAt?.trim() || null,
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

function normalizeCheckStatus(
  item: Schema.Schema.Type<typeof RawStatusCheckRollupItemSchema>,
): GitPullRequestCheckStatus {
  if (typeof item.state === "string" && item.state.length > 0) {
    switch (item.state) {
      case "SUCCESS":
        return "success";
      case "FAILURE":
      case "ERROR":
        return "failure";
      default:
        return "pending";
    }
  }
  if (typeof item.status === "string" && item.status !== "COMPLETED") return "pending";
  switch (item.conclusion) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failure";
    case "SKIPPED":
      return "skipped";
    case "CANCELLED":
      return "cancelled";
    case "NEUTRAL":
    case "STALE":
      return "neutral";
    default:
      return "pending";
  }
}

export function normalizePullRequestChecks(
  raw: Schema.Schema.Type<typeof RawPullRequestChecksSchema>,
): GitPullRequestCheck[] {
  const checks: GitPullRequestCheck[] = [];
  for (const item of raw.statusCheckRollup ?? []) {
    const name = (item.name ?? item.context ?? "").trim();
    if (name.length === 0) continue;
    checks.push({
      name,
      status: normalizeCheckStatus(item),
      url: item.detailsUrl ?? item.targetUrl ?? null,
    });
  }
  return checks;
}

function normalizeActor(
  raw: Schema.Schema.Type<typeof RawActorSchema> | null | undefined,
): PullRequestActor | null {
  if (!raw) return null;
  const login = raw.login ?? raw.slug;
  if (!login) return null;
  return {
    login,
    name: raw.name?.trim() || null,
    avatarUrl: raw.avatarUrl?.trim() || (raw.login ? githubAvatarUrlForLogin(raw.login) : null),
    url: raw.url?.trim() || null,
  };
}

function normalizeLabels(
  raw: ReadonlyArray<Schema.Schema.Type<typeof RawLabelSchema>> | null | undefined,
): PullRequestLabel[] {
  return (raw ?? []).map((label) => ({ name: label.name, color: label.color?.trim() || null }));
}

function nonNegativeCount(value: number | null | undefined): number {
  return normalizeDiffCount(value) ?? 0;
}

export function normalizePullRequestListItem(
  raw: Schema.Schema.Type<typeof RawPullRequestListItemSchema>,
): GitHubPullRequestListItem {
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: normalizeActor(raw.author),
    headBranch: raw.headRefName,
    baseBranch: raw.baseRefName,
    state: normalizePullRequestState(raw),
    isDraft: raw.isDraft === true,
    additions: nonNegativeCount(raw.additions),
    deletions: nonNegativeCount(raw.deletions),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    reviewDecision: raw.reviewDecision?.trim() || null,
    reviewRequestLogins: (raw.reviewRequests ?? []).flatMap((actor) =>
      actor.login ? [actor.login] : [],
    ),
    labels: normalizeLabels(raw.labels),
    mergeability: normalizePullRequestMergeability(raw.mergeable),
  };
}

function normalizeDetailedChecks(
  raw: Schema.Schema.Type<typeof RawPullRequestChecksSchema>,
): PullRequestCheck[] {
  return (raw.statusCheckRollup ?? []).flatMap((item) => {
    const name = (item.name ?? item.context ?? "").trim();
    if (!name) return [];
    return [
      {
        name,
        status: normalizeCheckStatus(item),
        description: item.description?.trim() || null,
        url: item.detailsUrl ?? item.targetUrl ?? null,
        startedAt: item.startedAt?.trim() || null,
        completedAt: item.completedAt?.trim() || null,
      },
    ];
  });
}

function normalizeDetailComments(
  raw: Schema.Schema.Type<typeof RawPullRequestDetailSchema>,
): PullRequestComment[] {
  const issueComments: PullRequestComment[] = (raw.comments ?? []).flatMap((comment, index) => {
    if (!comment.createdAt) return [];
    return [
      {
        id: comment.id?.trim() || `issue-comment-${index}-${comment.createdAt}`,
        kind: "issue-comment" as const,
        author: normalizeActor(comment.author),
        body: comment.body ?? "",
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt?.trim() || null,
        url: comment.url?.trim() || null,
        path: null,
        reviewState: null,
      },
    ];
  });
  const reviews: PullRequestComment[] = (raw.reviews ?? []).flatMap((review, index) => {
    const createdAt = review.submittedAt?.trim() || review.updatedAt?.trim();
    if (!createdAt) return [];
    return [
      {
        id: review.id?.trim() || `review-${index}-${createdAt}`,
        kind: "review" as const,
        author: normalizeActor(review.author),
        body: review.body ?? "",
        createdAt,
        updatedAt: review.updatedAt?.trim() || null,
        url: review.url?.trim() || null,
        path: null,
        reviewState: review.state?.trim() || null,
      },
    ];
  });
  return [...issueComments, ...reviews];
}

export function normalizePullRequestDetail(
  raw: Schema.Schema.Type<typeof RawPullRequestDetailSchema>,
): GitHubPullRequestDetailData {
  const reviewers = new Map<string, PullRequestActor>();
  for (const actor of [
    ...(raw.reviewRequests ?? []),
    ...(raw.reviews ?? []).flatMap((review) => (review.author ? [review.author] : [])),
  ]) {
    const normalized = normalizeActor(actor);
    if (normalized) reviewers.set(normalized.login.toLowerCase(), normalized);
  }
  return {
    ...normalizePullRequestListItem(raw),
    body: raw.body ?? "",
    mergeable: raw.mergeable?.trim() || null,
    mergeStateStatus: raw.mergeStateStatus?.trim() || null,
    changedFiles: nonNegativeCount(raw.changedFiles),
    mergedAt: raw.mergedAt?.trim() || null,
    closedAt: raw.closedAt?.trim() || null,
    maintainerCanModify: raw.maintainerCanModify === true,
    reviewers: [...reviewers.values()],
    checks: normalizeDetailedChecks(raw),
    comments: normalizeDetailComments(raw),
    commits: (raw.commits ?? []).map(
      (commit): PullRequestCommit => ({
        oid: commit.oid,
        messageHeadline: commit.messageHeadline?.trim() ?? "",
        messageBody: commit.messageBody ?? "",
        committedDate: commit.committedDate,
        authors: (commit.authors ?? []).flatMap((actor) => {
          const normalized = normalizeActor(actor);
          return normalized ? [normalized] : [];
        }),
      }),
    ),
  };
}

export function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return { nameWithOwner: raw.nameWithOwner, url: raw.url, sshUrl: raw.sshUrl };
}

export type GitHubJsonOperation =
  | "listOpenPullRequests"
  | "listPullRequests"
  | "getPullRequest"
  | "getRepositoryCloneUrls"
  | "getPullRequestWithChecks"
  | "getPullRequestReviewComments"
  | "listRepositoryPullRequests"
  | "getPullRequestDetail"
  | "getPullRequestListItem"
  | "listReviewRequestedPullRequestNumbers"
  | "getRepositoryMergeCapabilities";

export function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation: GitHubJsonOperation,
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: error instanceof Error ? `${invalidDetail}: ${error.message}` : invalidDetail,
          cause: error,
        }),
    ),
  );
}

const decodeRawPullRequestListItem = Schema.decodeUnknownSync(RawPullRequestListItemSchema);

export function decodeRepositoryPullRequestListJson(
  raw: string,
): Effect.Effect<GitHubPullRequestListBatch, GitHubCliError> {
  const trimmed = raw.trim();
  if (!trimmed) return Effect.succeed({ entries: [], rawCount: 0 });
  return decodeGitHubJson(
    trimmed,
    Schema.Array(Schema.Unknown),
    "listRepositoryPullRequests",
    "GitHub CLI returned invalid repository PR list JSON.",
  ).pipe(
    Effect.map((rawEntries) => ({
      rawCount: rawEntries.length,
      entries: rawEntries.flatMap((entry) => {
        try {
          return [normalizePullRequestListItem(decodeRawPullRequestListItem(entry))];
        } catch {
          return [];
        }
      }),
    })),
  );
}

const decodeRawPullRequestEntry = Schema.decodeUnknownSync(RawGitHubPullRequestSchema);

export function decodePullRequestListJson(
  raw: string,
  operation: "listOpenPullRequests" | "listPullRequests" = "listPullRequests",
): Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return Effect.succeed([]);
  return decodeGitHubJson(
    trimmed,
    Schema.Array(Schema.Unknown),
    operation,
    "GitHub CLI returned invalid PR list JSON.",
  ).pipe(
    Effect.map((entries) =>
      entries.flatMap((entry) => {
        try {
          return [normalizePullRequestSummary(decodeRawPullRequestEntry(entry))];
        } catch {
          return [];
        }
      }),
    ),
  );
}
