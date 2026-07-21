import { Effect, Layer } from "effect";

import { GitHubCli, type GitHubCliShape } from "../Services/GitHubCli.ts";
import { makeGitHubCliExecution } from "./github-cli/githubCliExecution.ts";
import { makeGitHubMutationOperations } from "./github-cli/githubCliMutations.ts";
import { makeGitHubPullRequestReadOperations } from "./github-cli/githubCliPullRequestReads.ts";
import { makeGitHubRepositoryReadOperations } from "./github-cli/githubCliRepositoryReads.ts";
import { makeGitHubReviewThreadOperations } from "./github-cli/githubCliReviewThreads.ts";

export {
  decodePullRequestListJson,
  decodeRepositoryPullRequestListJson,
} from "./github-cli/githubCliNormalization.ts";
export {
  PULL_REQUEST_DETAIL_JSON_FIELDS,
  PULL_REQUEST_LIST_JSON_FIELDS,
} from "./github-cli/githubCliSchemas.ts";

const makeGitHubCli = Effect.sync(() => {
  const execution = makeGitHubCliExecution();
  return {
    execute: execution.execute,
    ...makeGitHubPullRequestReadOperations(execution.execute),
    ...makeGitHubRepositoryReadOperations(execution),
    ...makeGitHubReviewThreadOperations(execution.execute),
    ...makeGitHubMutationOperations(execution.execute),
  } satisfies GitHubCliShape;
});

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli);
