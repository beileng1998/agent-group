import { Effect } from "effect";

import { GitHubCliError } from "../../Errors.ts";
import { PULL_REQUEST_SUMMARY_JSON_FIELDS, type GitHubCliShape } from "../../Services/GitHubCli.ts";
import type { GitHubExecute } from "./githubCliExecution.ts";
import { GITHUB_HOST, validateRepository } from "./githubCliExecution.ts";
import {
  decodeGitHubJson,
  decodePullRequestListJson,
  normalizePullRequestChecks,
  normalizePullRequestSummary,
  normalizeRepositoryCloneUrls,
} from "./githubCliNormalization.ts";
import {
  RawGitHubPullRequestSchema,
  RawGitHubPullRequestWithChecksSchema,
  RawGitHubRepositoryCloneUrlsSchema,
} from "./githubCliSchemas.ts";

type PullRequestReadOperations = Pick<
  GitHubCliShape,
  | "getViewerLogin"
  | "listOpenPullRequests"
  | "listPullRequests"
  | "getPullRequest"
  | "getPullRequestWithChecks"
  | "getRepositoryCloneUrls"
  | "getDefaultBranch"
>;

export function makeGitHubPullRequestReadOperations(
  execute: GitHubExecute,
): PullRequestReadOperations {
  const listPullRequestsWithState = (
    input: { readonly cwd: string; readonly headSelector: string; readonly limit?: number },
    options: {
      readonly state: "open" | "all";
      readonly defaultLimit: number;
      readonly operation: "listOpenPullRequests" | "listPullRequests";
    },
  ) =>
    execute({
      cwd: input.cwd,
      args: [
        "pr",
        "list",
        "--head",
        input.headSelector,
        "--state",
        options.state,
        "--limit",
        String(input.limit ?? options.defaultLimit),
        "--json",
        PULL_REQUEST_SUMMARY_JSON_FIELDS,
      ],
    }).pipe(
      Effect.flatMap((result) => decodePullRequestListJson(result.stdout, options.operation)),
    );

  return {
    getViewerLogin: (input) =>
      execute({
        cwd: input.cwd,
        args: ["api", "user", "--hostname", GITHUB_HOST, "--jq", ".login"],
      }).pipe(
        Effect.flatMap((result) => {
          const login = result.stdout.trim();
          return login.length > 0
            ? Effect.succeed(login)
            : Effect.fail(
                new GitHubCliError({
                  operation: "getViewerLogin",
                  detail: "GitHub CLI returned an empty viewer login.",
                  reason: "other",
                }),
              );
        }),
      ),

    listOpenPullRequests: (input) =>
      listPullRequestsWithState(input, {
        state: "open",
        defaultLimit: 1,
        operation: "listOpenPullRequests",
      }),

    listPullRequests: (input) =>
      listPullRequestsWithState(input, {
        state: "all",
        defaultLimit: 20,
        operation: "listPullRequests",
      }),

    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "view", input.reference, "--json", PULL_REQUEST_SUMMARY_JSON_FIELDS],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubPullRequestSchema,
            "getPullRequest",
            "GitHub CLI returned invalid pull request JSON.",
          ),
        ),
        Effect.map(normalizePullRequestSummary),
      ),

    getPullRequestWithChecks: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          `${PULL_REQUEST_SUMMARY_JSON_FIELDS},statusCheckRollup`,
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubPullRequestWithChecksSchema,
            "getPullRequestWithChecks",
            "GitHub CLI returned invalid pull request JSON.",
          ),
        ),
        Effect.map((decoded) => ({
          summary: normalizePullRequestSummary(decoded),
          checks: normalizePullRequestChecks(decoded),
        })),
      ),

    getRepositoryCloneUrls: (input) =>
      validateRepository(input.repository, "getRepositoryCloneUrls").pipe(
        Effect.flatMap((repository) =>
          execute({
            cwd: input.cwd,
            args: ["repo", "view", repository, "--json", "nameWithOwner,url,sshUrl"],
          }),
        ),
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),

    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
  };
}
