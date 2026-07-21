import { Effect } from "effect";

import type { GitHubCliShape } from "../../Services/GitHubCli.ts";
import type { GitHubExecute } from "./githubCliExecution.ts";
import { repositorySelector, validateRepository } from "./githubCliExecution.ts";

type MutationOperations = Pick<
  GitHubCliShape,
  "runPullRequestAction" | "commentOnPullRequest" | "createPullRequest" | "checkoutPullRequest"
>;

export function makeGitHubMutationOperations(execute: GitHubExecute): MutationOperations {
  return {
    runPullRequestAction: (input) =>
      validateRepository(input.repository, "runPullRequestAction").pipe(
        Effect.flatMap((repository) => {
          const reference = String(input.number);
          const repoArgs = ["--repo", repositorySelector(repository)];
          const args = (() => {
            switch (input.action) {
              case "merge":
                return ["pr", "merge", reference, ...repoArgs, `--${input.mergeMethod ?? "merge"}`];
              case "ready":
                return ["pr", "ready", reference, ...repoArgs];
              case "draft":
                return ["pr", "ready", reference, ...repoArgs, "--undo"];
              case "close":
                return ["pr", "close", reference, ...repoArgs];
              case "reopen":
                return ["pr", "reopen", reference, ...repoArgs];
            }
          })();
          return execute({ cwd: input.cwd, args }).pipe(Effect.asVoid);
        }),
      ),

    commentOnPullRequest: (input) =>
      validateRepository(input.repository, "commentOnPullRequest").pipe(
        Effect.flatMap((repository) =>
          execute({
            cwd: input.cwd,
            args: [
              "pr",
              "comment",
              String(input.number),
              "--repo",
              repositorySelector(repository),
              "--body-file",
              "-",
            ],
            stdin: input.body,
          }),
        ),
        Effect.asVoid,
      ),

    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),

    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
  };
}
