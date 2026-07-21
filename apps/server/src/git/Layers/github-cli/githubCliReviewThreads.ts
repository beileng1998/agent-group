import { Effect, Schema } from "effect";
import type { GitPullRequestComment } from "@agent-group/contracts";

import { GitHubCliError } from "../../Errors.ts";
import type { GitHubCliShape } from "../../Services/GitHubCli.ts";
import type { GitHubExecute } from "./githubCliExecution.ts";
import { decodeGitHubJson } from "./githubCliNormalization.ts";
import {
  PULL_REQUEST_REVIEW_COMMENT_LIMIT,
  PULL_REQUEST_REVIEW_THREAD_PAGE_LIMIT,
  PULL_REQUEST_REVIEW_THREAD_PAGE_SIZE,
  PULL_REQUEST_REVIEW_THREADS_QUERY,
  RawReviewThreadsResponseSchema,
} from "./githubCliSchemas.ts";

function normalizePullRequestReviewComments(
  raw: Schema.Schema.Type<typeof RawReviewThreadsResponseSchema>,
): GitPullRequestComment[] {
  const threads = raw.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  const comments: GitPullRequestComment[] = [];
  for (const thread of threads) {
    if (!thread || thread.isResolved === true) continue;
    const rootComment = thread.comments?.nodes?.find((node) => node !== null) ?? null;
    if (!rootComment) continue;
    comments.push({
      id: rootComment.id,
      author: rootComment.author?.login?.trim() || null,
      body: rootComment.body ?? "",
      path: rootComment.path?.trim() || null,
      url: rootComment.url ?? null,
      createdAt: rootComment.createdAt?.trim() || null,
    });
  }
  return comments;
}

function getGraphQlErrorDetail(
  raw: Schema.Schema.Type<typeof RawReviewThreadsResponseSchema>,
): string | null {
  const messages =
    raw.errors
      ?.flatMap((error) => {
        const message = error?.message?.trim();
        return message ? [message] : [];
      })
      .join("; ") ?? "";
  return messages.length > 0 ? `GitHub GraphQL returned errors: ${messages}` : null;
}

function getPullRequestReviewThreadsPageInfo(
  raw: Schema.Schema.Type<typeof RawReviewThreadsResponseSchema>,
): { hasNextPage: boolean; endCursor: string | null } {
  const pageInfo = raw.data?.repository?.pullRequest?.reviewThreads?.pageInfo;
  return {
    hasNextPage: pageInfo?.hasNextPage === true,
    endCursor: pageInfo?.endCursor?.trim() || null,
  };
}

export function makeGitHubReviewThreadOperations(
  execute: GitHubExecute,
): Pick<GitHubCliShape, "getPullRequestReviewComments"> {
  return {
    getPullRequestReviewComments: (input) =>
      Effect.gen(function* () {
        const comments: GitPullRequestComment[] = [];
        let after: string | null = null;
        let fetchedPages = 0;
        let truncated = false;

        do {
          fetchedPages += 1;
          const args = [
            "api",
            "graphql",
            "--hostname",
            input.host,
            "-f",
            `query=${PULL_REQUEST_REVIEW_THREADS_QUERY}`,
            "-F",
            `owner=${input.owner}`,
            "-F",
            `repo=${input.repo}`,
            "-F",
            `number=${input.number}`,
            "-F",
            `first=${PULL_REQUEST_REVIEW_THREAD_PAGE_SIZE}`,
            ...(after ? ["-F", `after=${after}`] : []),
          ];

          const raw = yield* execute({ cwd: input.cwd, args }).pipe(
            Effect.map((result) => result.stdout.trim()),
          );
          const decoded = yield* decodeGitHubJson(
            raw,
            RawReviewThreadsResponseSchema,
            "getPullRequestReviewComments",
            "GitHub CLI returned invalid review threads JSON.",
          );
          const errorDetail = getGraphQlErrorDetail(decoded);
          if (errorDetail) {
            return yield* Effect.fail(
              new GitHubCliError({
                operation: "getPullRequestReviewComments",
                detail: errorDetail,
              }),
            );
          }

          const remaining = PULL_REQUEST_REVIEW_COMMENT_LIMIT - comments.length;
          const pageComments = normalizePullRequestReviewComments(decoded);
          if (pageComments.length > remaining) truncated = true;
          comments.push(...pageComments.slice(0, Math.max(remaining, 0)));

          const pageInfo = getPullRequestReviewThreadsPageInfo(decoded);
          const canFetchNextPage =
            pageInfo.hasNextPage &&
            pageInfo.endCursor !== null &&
            comments.length < PULL_REQUEST_REVIEW_COMMENT_LIMIT &&
            fetchedPages < PULL_REQUEST_REVIEW_THREAD_PAGE_LIMIT;
          if (!canFetchNextPage && pageInfo.hasNextPage) truncated = true;
          after = canFetchNextPage ? pageInfo.endCursor : null;
        } while (after !== null);

        return { comments, truncated };
      }),
  };
}
