import {
  type OrchestrationProject,
  type OrchestrationReadModel,
  type PullRequestDetail,
  type PullRequestsListResult,
} from "@agent-group/contracts";
import type { Effect } from "effect";

import { GitHubCliError } from "../../../git/Errors";
import type { GitHubCliShape, GitHubPullRequestListItem } from "../../../git/Services/GitHubCli";
import type { ProjectPullRequestPinsShape } from "../../../persistence/Services/ProjectPullRequestPins";
import type { GitHubRepositoryInventory } from "../../repositoryResolution";

export const GITHUB_REPOSITORY_CACHE_MAX_ENTRIES = 256;
export const PULL_REQUEST_LIST_CACHE_MAX_ENTRIES = 512;
export const PULL_REQUEST_PIN_ITEM_CACHE_MAX_ENTRIES = 128;
export const PULL_REQUEST_REVIEW_MATCH_CACHE_MAX_ENTRIES = 32;
export const PULL_REQUEST_MERGE_CAPABILITIES_CACHE_MAX_ENTRIES = 64;

export type PullRequestListBatch = {
  readonly entries: ReadonlyArray<GitHubPullRequestListItem>;
  readonly truncated: boolean;
};

export type PullRequestListError = PullRequestsListResult["errors"][number];

export interface PullRequestServiceDependencies {
  readonly homeDir: string;
  readonly github: GitHubCliShape;
  readonly pins: ProjectPullRequestPinsShape;
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, unknown>;
  readonly resolveRepositories: (
    project: OrchestrationProject,
  ) => Effect.Effect<GitHubRepositoryInventory, unknown>;
}

/** Exact gh error shape for a PR number that is known not to exist. Generic 404/auth failures are
 * deliberately not classified as absence, so permission and network failures remain visible. */
export function isDefinitivePullRequestNotFound(error: GitHubCliError): boolean {
  if (isGlobalGitHubCliError(error)) return false;
  const detail = error.detail.toLowerCase();
  return (
    detail.includes("could not resolve to a pullrequest") ||
    /pull request(?: with (?:the )?number)?[^\n]*(?:not found|does not exist)/i.test(
      error.detail,
    ) ||
    /no pull request[^\n]*found/i.test(error.detail)
  );
}

export function pullRequestCacheKeyBelongsToRepository(
  cacheKey: string,
  repository: string,
  separator: ":" | "\u0000" = ":",
): boolean {
  return cacheKey.startsWith(`${repository.trim().toLowerCase()}${separator}`);
}

// Boolean rather than a type predicate: it is called on values already typed
// GitHubCliError, where a predicate would narrow the false branch to `never`.
export function isGlobalGitHubCliError(error: unknown): boolean {
  return (
    error instanceof GitHubCliError &&
    (error.reason === "not-installed" || error.reason === "not-authenticated")
  );
}
