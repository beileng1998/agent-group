import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { FileSystem, Path } from "effect";
import type { GitCoreShape } from "../../Services/GitCore.ts";
import type { GitHubCliShape } from "../../Services/GitHubCli.ts";
import type { TextGenerationShape } from "../../Services/TextGeneration.ts";
import { buildGitTextGenerationCallInput } from "../../textGenerationSelection.ts";
import { isPullRequestAlreadyExistsError } from "./pullRequestIdentity.ts";
import { gitManagerError } from "./gitManagerErrors.ts";
import { limitContext } from "./commitSuggestionValues.ts";
import type { GitTextGenerationParams } from "./gitManagerTypes.ts";
import type { makePullRequestLookup } from "./pullRequestLookup.ts";

export function makePullRequestCreation(deps: {
  gitCore: GitCoreShape;
  gitHubCli: GitHubCliShape;
  textGeneration: TextGenerationShape;
  fileSystem: FileSystem.FileSystem;
  path: Path.Path;
  tempDir: string;
  lookup: ReturnType<typeof makePullRequestLookup>;
}) {
  const { gitCore, gitHubCli, textGeneration, fileSystem, path, tempDir } = deps;
  const {
    resolveBranchHeadContext,
    findOpenPr,
    resolveAlreadyExistingPullRequest,
    resolveBaseBranch,
  } = deps.lookup;
  const runPrStep = (
    cwd: string,
    fallbackBranch: string | null,
    textGenerationParams?: GitTextGenerationParams,
  ) =>
    Effect.gen(function* () {
      const details = yield* gitCore.statusDetails(cwd);
      const branch = details.branch ?? fallbackBranch;
      if (!branch) {
        return yield* gitManagerError(
          "runPrStep",
          "Cannot create a pull request from detached HEAD.",
        );
      }
      if (!details.hasUpstream) {
        return yield* gitManagerError(
          "runPrStep",
          "Current branch has not been pushed. Push before creating a PR.",
        );
      }

      const headContext = yield* resolveBranchHeadContext(cwd, {
        branch,
        upstreamRef: details.upstreamRef,
      });

      const existing = yield* findOpenPr(cwd, headContext);
      if (existing) {
        return {
          status: "opened_existing" as const,
          url: existing.url,
          number: existing.number,
          baseBranch: existing.baseRefName,
          headBranch: existing.headRefName,
          title: existing.title,
        };
      }

      const baseBranch = yield* resolveBaseBranch(cwd, branch, details.upstreamRef, headContext);
      if (!headContext.isCrossRepository && baseBranch === headContext.headBranch) {
        return yield* gitManagerError(
          "runPrStep",
          `Cannot create a pull request from '${headContext.headBranch}' into itself. Create or switch to a feature branch and retry.`,
        );
      }
      const rangeContext = yield* gitCore.readRangeContext(cwd, baseBranch);

      const generated = yield* textGeneration.generatePrContent({
        cwd,
        baseBranch,
        headBranch: headContext.headBranch,
        commitSummary: limitContext(rangeContext.commitSummary, 20_000),
        diffSummary: limitContext(rangeContext.diffSummary, 20_000),
        diffPatch: limitContext(rangeContext.diffPatch, 60_000),
        ...buildGitTextGenerationCallInput(textGenerationParams ?? {}),
      });

      const bodyFile = path.join(tempDir, `agent-group-pr-body-${process.pid}-${randomUUID()}.md`);
      yield* fileSystem
        .writeFileString(bodyFile, generated.body)
        .pipe(
          Effect.mapError((cause) =>
            gitManagerError("runPrStep", "Failed to write pull request body temp file.", cause),
          ),
        );
      const existingAfterCreateConflict = yield* gitHubCli
        .createPullRequest({
          cwd,
          baseBranch,
          headSelector: headContext.preferredHeadSelector,
          title: generated.title,
          bodyFile,
        })
        .pipe(
          Effect.as(null),
          Effect.catch((error) => {
            if (!isPullRequestAlreadyExistsError(error)) {
              return Effect.fail(error);
            }
            return resolveAlreadyExistingPullRequest(cwd, error, headContext);
          }),
          Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))),
        );
      if (existingAfterCreateConflict) {
        return {
          status: "opened_existing" as const,
          url: existingAfterCreateConflict.url,
          number: existingAfterCreateConflict.number,
          baseBranch: existingAfterCreateConflict.baseRefName,
          headBranch: existingAfterCreateConflict.headRefName,
          title: existingAfterCreateConflict.title,
        };
      }

      const created = yield* findOpenPr(cwd, headContext);
      if (!created) {
        return {
          status: "created" as const,
          baseBranch,
          headBranch: headContext.headBranch,
          title: generated.title,
        };
      }

      return {
        status: "created" as const,
        url: created.url,
        number: created.number,
        baseBranch: created.baseRefName,
        headBranch: created.headRefName,
        title: created.title,
      };
    });

  return { runPrStep };
}
