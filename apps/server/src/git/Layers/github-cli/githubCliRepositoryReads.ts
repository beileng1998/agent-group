import { Effect, Schema } from "effect";
import type { PullRequestMergeCapabilities } from "@agent-group/contracts";

import { GitHubCliError } from "../../Errors.ts";
import type { GitHubCliShape } from "../../Services/GitHubCli.ts";
import type { GitHubExecute } from "./githubCliExecution.ts";
import {
  PULL_REQUEST_DIFF_MAX_BYTES,
  repositorySelector,
  validateRepository,
} from "./githubCliExecution.ts";
import {
  decodeGitHubJson,
  decodeRepositoryPullRequestListJson,
  normalizePullRequestDetail,
  normalizePullRequestListItem,
} from "./githubCliNormalization.ts";
import {
  PULL_REQUEST_DETAIL_JSON_FIELDS,
  PULL_REQUEST_LIST_JSON_FIELDS,
  RawPullRequestDetailSchema,
  RawPullRequestListItemSchema,
  RawPullRequestNumberSchema,
  RawRepositoryMergeCapabilitiesSchema,
} from "./githubCliSchemas.ts";

type RepositoryReadOperations = Pick<
  GitHubCliShape,
  | "listRepositoryPullRequests"
  | "getPullRequestListItem"
  | "listReviewRequestedPullRequestNumbers"
  | "getPullRequestDetail"
  | "getRepositoryMergeCapabilities"
  | "getPullRequestDiff"
>;

const decodeRawPullRequestListItem = Schema.decodeUnknownSync(RawPullRequestListItemSchema);

export function makeGitHubRepositoryReadOperations(input: {
  execute: GitHubExecute;
  localPullRequestDiff: (
    cwd: string,
    repository: string,
    number: number,
  ) => Effect.Effect<{ patch: string; truncated: boolean }, GitHubCliError>;
}): RepositoryReadOperations {
  const { execute, localPullRequestDiff } = input;
  return {
    listRepositoryPullRequests: (request) => {
      const searchTerms = [
        ...(request.involvement === "reviewing" ? [`review-requested:${request.viewer}`] : []),
        ...(request.state === "closed" ? ["is:unmerged"] : []),
      ];
      const involvementArgs = [
        ...(request.involvement === "authored" ? ["--author", request.viewer] : []),
        ...(searchTerms.length > 0 ? ["--search", searchTerms.join(" ")] : []),
      ];
      return validateRepository(request.repository, "listRepositoryPullRequests").pipe(
        Effect.flatMap((repository) =>
          execute({
            cwd: request.cwd,
            args: [
              "pr",
              "list",
              "--repo",
              repositorySelector(repository),
              ...involvementArgs,
              "--state",
              request.state,
              "--limit",
              String(request.limit ?? 50),
              "--json",
              PULL_REQUEST_LIST_JSON_FIELDS,
            ],
          }),
        ),
        Effect.flatMap((result) => decodeRepositoryPullRequestListJson(result.stdout)),
      );
    },

    getPullRequestListItem: (request) =>
      validateRepository(request.repository, "getPullRequestListItem").pipe(
        Effect.flatMap((repository) =>
          execute({
            cwd: request.cwd,
            args: [
              "pr",
              "view",
              String(request.number),
              "--repo",
              repositorySelector(repository),
              "--json",
              PULL_REQUEST_LIST_JSON_FIELDS,
            ],
          }),
        ),
        Effect.flatMap((result) =>
          decodeGitHubJson(
            result.stdout.trim(),
            Schema.Unknown,
            "getPullRequestListItem",
            "GitHub CLI returned invalid pull request JSON.",
          ),
        ),
        Effect.flatMap((entry) =>
          Effect.try({
            try: () => normalizePullRequestListItem(decodeRawPullRequestListItem(entry)),
            catch: () =>
              new GitHubCliError({
                operation: "getPullRequestListItem",
                detail: "GitHub CLI returned an unrecognized pull request shape.",
                reason: "other",
              }),
          }),
        ),
      ),

    listReviewRequestedPullRequestNumbers: (request) =>
      validateRepository(request.repository, "listReviewRequestedPullRequestNumbers").pipe(
        Effect.flatMap((repository) =>
          execute({
            cwd: request.cwd,
            args: [
              "search",
              "prs",
              "--repo",
              repository,
              "--review-requested",
              request.viewer,
              "--state",
              "open",
              "--limit",
              String(request.limit ?? 1_000),
              "--json",
              "number",
            ],
          }),
        ),
        Effect.flatMap((result) =>
          decodeGitHubJson(
            result.stdout.trim(),
            Schema.Array(RawPullRequestNumberSchema),
            "listReviewRequestedPullRequestNumbers",
            "GitHub CLI returned invalid review-requested pull request JSON.",
          ),
        ),
        Effect.map((entries) => entries.map((entry) => entry.number)),
      ),

    getPullRequestDetail: (request) =>
      validateRepository(request.repository, "getPullRequestDetail").pipe(
        Effect.flatMap((repository) =>
          execute({
            cwd: request.cwd,
            args: [
              "pr",
              "view",
              String(request.number),
              "--repo",
              repositorySelector(repository),
              "--json",
              PULL_REQUEST_DETAIL_JSON_FIELDS,
            ],
          }),
        ),
        Effect.flatMap((result) =>
          decodeGitHubJson(
            result.stdout.trim(),
            RawPullRequestDetailSchema,
            "getPullRequestDetail",
            "GitHub CLI returned invalid pull request detail JSON.",
          ),
        ),
        Effect.map(normalizePullRequestDetail),
      ),

    getRepositoryMergeCapabilities: (request) =>
      validateRepository(request.repository, "getRepositoryMergeCapabilities").pipe(
        Effect.flatMap((repository) =>
          execute({
            cwd: request.cwd,
            args: [
              "repo",
              "view",
              repositorySelector(repository),
              "--json",
              "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,deleteBranchOnMerge",
            ],
          }),
        ),
        Effect.flatMap((result) =>
          decodeGitHubJson(
            result.stdout.trim(),
            RawRepositoryMergeCapabilitiesSchema,
            "getRepositoryMergeCapabilities",
            "GitHub CLI returned invalid repository merge settings JSON.",
          ),
        ),
        Effect.map(
          (raw): PullRequestMergeCapabilities => ({
            merge: raw.mergeCommitAllowed,
            squash: raw.squashMergeAllowed,
            rebase: raw.rebaseMergeAllowed,
            deleteBranchOnMerge: raw.deleteBranchOnMerge,
          }),
        ),
      ),

    getPullRequestDiff: (request) =>
      validateRepository(request.repository, "getPullRequestDiff").pipe(
        Effect.flatMap((repository) =>
          execute({
            cwd: request.cwd,
            args: [
              "pr",
              "diff",
              String(request.number),
              "--repo",
              repositorySelector(repository),
              "--color",
              "never",
              "--patch",
            ],
            maxBufferBytes: PULL_REQUEST_DIFF_MAX_BYTES,
            outputMode: "truncate",
          }).pipe(
            Effect.map((result) => ({
              patch: result.stdout,
              truncated: result.stdoutTruncated === true,
            })),
            Effect.catch((error) =>
              /exceeded the maximum number of files|too_large/i.test(error.detail)
                ? localPullRequestDiff(request.cwd, repository, request.number)
                : Effect.fail(error),
            ),
          ),
        ),
      ),
  };
}
