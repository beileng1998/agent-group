import { Effect } from "effect";
import type { GitManagerShape } from "../../Services/GitManager.ts";
import type { GitCoreShape } from "../../Services/GitCore.ts";
import type { GitHubCliShape } from "../../Services/GitHubCli.ts";
import type { TextGenerationShape } from "../../Services/TextGeneration.ts";
import { buildGitTextGenerationCallInput } from "../../textGenerationSelection.ts";
import { gitManagerError } from "./gitManagerErrors.ts";
import {
  normalizePullRequestReference,
  parsePullRequestRepositoryFromUrl,
  toResolvedPullRequest,
} from "./pullRequestIdentity.ts";
import type { makePullRequestLookup } from "./pullRequestLookup.ts";

export function makeGitReadOperations(deps: {
  gitCore: GitCoreShape;
  gitHubCli: GitHubCliShape;
  textGeneration: TextGenerationShape;
  lookup: ReturnType<typeof makePullRequestLookup>;
}) {
  const { gitCore, gitHubCli, textGeneration } = deps;
  const { findLatestPr } = deps.lookup;
  const status: GitManagerShape["status"] = Effect.fnUntraced(function* (input) {
    const details = yield* gitCore.statusDetails(input.cwd);

    const pr =
      details.branch !== null
        ? yield* findLatestPr(input.cwd, {
            branch: details.branch,
            upstreamRef: details.upstreamRef,
          }).pipe(
            // Status and PR-resolution surfaces share one mapper so their shapes cannot drift.
            Effect.map((latest) => (latest ? toResolvedPullRequest(latest) : null)),
            Effect.catch(() => Effect.succeed(null)),
          )
        : null;

    return {
      branch: details.branch,
      hasWorkingTreeChanges: details.hasWorkingTreeChanges,
      workingTree: details.workingTree,
      hasUpstream: details.hasUpstream,
      upstreamBranch: details.upstreamBranch,
      aheadCount: details.aheadCount,
      behindCount: details.behindCount,
      pr,
    };
  });

  const readWorkingTreeDiff: GitManagerShape["readWorkingTreeDiff"] = Effect.fnUntraced(
    function* (input) {
      switch (input.scope) {
        case "branch":
          return yield* gitCore.readBranchPatch(input.cwd);
        case "staged":
          return yield* gitCore.readStagedPatch(input.cwd);
        case "unstaged":
          return yield* gitCore.readUnstagedPatch(input.cwd);
        case "workingTree":
        default:
          return yield* gitCore.readWorkingTreePatch(input.cwd);
      }
    },
  );

  // Keep diff summaries read-only by summarizing the patch already selected in the UI.
  const summarizeDiff: GitManagerShape["summarizeDiff"] = Effect.fnUntraced(function* (input) {
    const patch = input.patch.trim();
    if (patch.length === 0) {
      return yield* gitManagerError("summarizeDiff", "Cannot summarize an empty diff.");
    }

    const generated = yield* textGeneration.generateDiffSummary({
      cwd: input.cwd,
      patch,
      ...buildGitTextGenerationCallInput({
        textGenerationModel: input.textGenerationModel,
        textGenerationModelSelection: input.textGenerationModelSelection,
        codexHomePath: input.codexHomePath,
        providerOptions: input.providerOptions,
      }),
    });

    return {
      summary: generated.summary,
    };
  });

  const resolvePullRequest: GitManagerShape["resolvePullRequest"] = Effect.fnUntraced(
    function* (input) {
      const pullRequest = yield* gitHubCli
        .getPullRequest({
          cwd: input.cwd,
          reference: normalizePullRequestReference(input.reference),
        })
        .pipe(Effect.map((resolved) => toResolvedPullRequest(resolved)));

      return { pullRequest };
    },
  );

  const pullRequestSnapshot: GitManagerShape["pullRequestSnapshot"] = Effect.fnUntraced(
    function* (input) {
      const reference = normalizePullRequestReference(input.reference);
      // Summary + checks ride one `gh pr view` call: one process/API round trip per poll,
      // and no separate checks failure mode that could discard an otherwise-usable snapshot.
      const { summary, checks } = yield* gitHubCli.getPullRequestWithChecks({
        cwd: input.cwd,
        reference,
      });
      const pullRequest = toResolvedPullRequest(summary);

      const repository = parsePullRequestRepositoryFromUrl(pullRequest.url);
      if (!repository) {
        return yield* gitManagerError(
          "pullRequestSnapshot",
          `Could not determine the repository from the pull request URL: ${pullRequest.url}`,
        );
      }

      const commentsResult = yield* gitHubCli
        .getPullRequestReviewComments({
          cwd: input.cwd,
          host: repository.host,
          owner: repository.owner,
          repo: repository.repo,
          number: pullRequest.number,
        })
        .pipe(
          Effect.map((result) => ({
            comments: result.comments,
            commentsTruncated: result.truncated,
            commentsError: null,
          })),
          Effect.catch((error) =>
            Effect.succeed({
              comments: [],
              commentsTruncated: false,
              commentsError: error.message,
            }),
          ),
        );

      return {
        pullRequest,
        checks,
        comments: commentsResult.comments,
        commentsTruncated: commentsResult.commentsTruncated,
        commentsError: commentsResult.commentsError,
      };
    },
  );

  return {
    status,
    readWorkingTreeDiff,
    summarizeDiff,
    resolvePullRequest,
    pullRequestSnapshot,
  };
}
