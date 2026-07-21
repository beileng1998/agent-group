import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type {
  GitActionProgressEvent,
  GitActionProgressPhase,
  GitStackedAction,
} from "@agent-group/contracts";
import { resolveAutoFeatureBranchName, sanitizeFeatureBranchName } from "@agent-group/shared/git";
import type { GitManagerShape, GitRunStackedActionOptions } from "../../Services/GitManager.ts";
import type { GitCoreShape } from "../../Services/GitCore.ts";
import { isCommitAction, prioritizeRemoteNames } from "./commitSuggestionValues.ts";
import { gitManagerError } from "./gitManagerErrors.ts";
import type {
  CommitAndBranchSuggestion,
  FeatureBranchStepOptions,
  GitActionProgressPayload,
  GitTextGenerationParams,
} from "./gitManagerTypes.ts";
import type { makeCommitOperations } from "./commitOperations.ts";
import type { makePullRequestCreation } from "./pullRequestCreation.ts";

export function makeStackedAction(deps: {
  gitCore: GitCoreShape;
  commitOperations: ReturnType<typeof makeCommitOperations>;
  pullRequestCreation: ReturnType<typeof makePullRequestCreation>;
}) {
  const { gitCore } = deps;
  const { resolveCommitAndBranchSuggestion, runCommitStep } = deps.commitOperations;
  const { runPrStep } = deps.pullRequestCreation;
  const createProgressEmitter = (
    input: { cwd: string; action: GitStackedAction },
    options?: GitRunStackedActionOptions,
  ) => {
    const actionId = options?.actionId ?? randomUUID();
    const reporter = options?.progressReporter;

    const emit = (event: GitActionProgressPayload) =>
      reporter
        ? reporter.publish({
            actionId,
            cwd: input.cwd,
            action: input.action,
            ...event,
          } as GitActionProgressEvent)
        : Effect.void;

    return {
      actionId,
      emit,
    };
  };

  const runFeatureBranchStep = (
    cwd: string,
    branch: string | null,
    commitMessage?: string,
    filePaths?: readonly string[],
    textGenerationParams?: GitTextGenerationParams,
    options?: FeatureBranchStepOptions,
  ) =>
    Effect.gen(function* () {
      const suggestion = yield* resolveCommitAndBranchSuggestion({
        cwd,
        branch,
        ...(commitMessage ? { commitMessage } : {}),
        ...(filePaths ? { filePaths } : {}),
        includeBranch: true,
        ...(textGenerationParams ?? {}),
      });
      if (!suggestion && !options?.allowCommittedHead) {
        return yield* gitManagerError(
          "runFeatureBranchStep",
          "Cannot create a feature branch because there are no changes to commit.",
        );
      }

      const existingBranchNames = yield* gitCore.listLocalBranchNames(cwd);
      const committedHeadBranchBase = yield* Effect.gen(function* () {
        if (suggestion) {
          return suggestion.branch ?? sanitizeFeatureBranchName(suggestion.subject);
        }
        const latestCommitSubject = yield* gitCore
          .execute({
            operation: "GitManager.runFeatureBranchStep.readHeadSubject",
            cwd,
            args: ["log", "-1", "--pretty=%s"],
          })
          .pipe(Effect.map((result) => result.stdout.trim().split(/\r?\n/g)[0]?.trim() ?? ""));
        if (latestCommitSubject.length > 0) {
          return latestCommitSubject;
        }
        return branch ? `${branch}-update` : undefined;
      });
      const resolvedBranch = resolveAutoFeatureBranchName(
        existingBranchNames,
        committedHeadBranchBase,
      );

      yield* gitCore.createBranch({ cwd, branch: resolvedBranch });
      yield* Effect.scoped(gitCore.checkoutBranch({ cwd, branch: resolvedBranch }));
      if (options?.restoreOriginalBranchRef && branch) {
        // Move the original branch back to its trusted remote/upstream ref so
        // "create feature branch and continue" actually removes the commits
        // from the source branch instead of leaving both branches pointing at them.
        yield* gitCore.execute({
          operation: "GitManager.runFeatureBranchStep.restoreOriginalBranch",
          cwd,
          args: ["branch", "--force", branch, options.restoreOriginalBranchRef],
        });
      }

      return {
        branchStep: { status: "created" as const, name: resolvedBranch },
        resolvedCommitMessage: suggestion?.commitMessage,
        resolvedCommitSuggestion: suggestion ?? undefined,
      };
    });

  const resolveCommittedHeadRestoreRef = (
    cwd: string,
    details: { branch: string | null; upstreamRef: string | null },
  ) =>
    Effect.gen(function* () {
      if (!details.branch) {
        return null;
      }
      if (details.upstreamRef) {
        return details.upstreamRef;
      }

      const remoteNames = yield* gitCore
        .execute({
          operation: "GitManager.resolveCommittedHeadRestoreRef.listRemotes",
          cwd,
          args: ["remote"],
          allowNonZeroExit: true,
          timeoutMs: 5_000,
        })
        .pipe(Effect.map((result) => prioritizeRemoteNames(result.stdout.split(/\r?\n/g))));
      if (remoteNames.length > 1) {
        return yield* gitManagerError(
          "resolveCommittedHeadRestoreRef",
          `Cannot move committed work to a feature branch because '${details.branch}' has no upstream and this repository has multiple remotes. Push the branch first or configure its upstream before retrying.`,
        );
      }

      for (const remoteName of remoteNames) {
        const remoteRef = `${remoteName}/${details.branch}`;
        const remoteExists = yield* gitCore
          .execute({
            operation: "GitManager.resolveCommittedHeadRestoreRef.remoteExists",
            cwd,
            args: ["show-ref", "--verify", "--quiet", `refs/remotes/${remoteRef}`],
            allowNonZeroExit: true,
            timeoutMs: 5_000,
          })
          .pipe(Effect.map((result) => result.code === 0));
        if (!remoteExists) {
          continue;
        }

        yield* gitCore.execute({
          operation: "GitManager.resolveCommittedHeadRestoreRef.refreshRemoteBranch",
          cwd,
          args: [
            "fetch",
            "--quiet",
            "--no-tags",
            remoteName,
            `+refs/heads/${details.branch}:refs/remotes/${remoteRef}`,
          ],
          timeoutMs: 10_000,
        });
        return remoteRef;
      }

      return yield* gitManagerError(
        "resolveCommittedHeadRestoreRef",
        `Cannot move committed work to a feature branch because '${details.branch}' has no upstream or matching remote branch to restore.`,
      );
    });

  const runStackedAction: GitManagerShape["runStackedAction"] = Effect.fnUntraced(
    function* (input, options) {
      const progress = createProgressEmitter(input, options);
      let currentPhase: GitActionProgressPhase | null = null;

      const runAction = Effect.gen(function* () {
        const initialStatus = yield* gitCore.statusDetails(input.cwd);
        const textGenerationParams: GitTextGenerationParams = {
          textGenerationModel: input.textGenerationModel,
          textGenerationModelSelection: input.textGenerationModelSelection,
          codexHomePath: input.codexHomePath,
          providerOptions: input.providerOptions,
        };
        const wantsCommit = isCommitAction(input.action);
        const wantsPush =
          input.action === "push" ||
          input.action === "commit_push" ||
          input.action === "commit_push_pr" ||
          (input.action === "create_pr" &&
            (input.featureBranch || !initialStatus.hasUpstream || initialStatus.aheadCount > 0));
        const wantsPr = input.action === "create_pr" || input.action === "commit_push_pr";
        const phases: GitActionProgressPhase[] = [
          ...(input.featureBranch ? (["branch"] as const) : []),
          ...(wantsCommit ? (["commit"] as const) : []),
          ...(wantsPush ? (["push"] as const) : []),
          ...(wantsPr ? (["pr"] as const) : []),
        ];

        yield* progress.emit({
          kind: "action_started",
          phases,
        });

        if (input.action === "push" && initialStatus.hasWorkingTreeChanges) {
          return yield* gitManagerError(
            "runStackedAction",
            "Commit or stash local changes before pushing.",
          );
        }
        if (input.action === "create_pr" && initialStatus.hasWorkingTreeChanges) {
          return yield* gitManagerError(
            "runStackedAction",
            "Commit local changes before creating a PR.",
          );
        }
        if (!input.featureBranch && wantsPush && !initialStatus.branch) {
          return yield* gitManagerError("runStackedAction", "Cannot push from detached HEAD.");
        }
        if (!input.featureBranch && wantsPr && !initialStatus.branch) {
          return yield* gitManagerError(
            "runStackedAction",
            "Cannot create a pull request from detached HEAD.",
          );
        }
        const committedHeadRestoreRef =
          input.featureBranch && !wantsCommit
            ? yield* resolveCommittedHeadRestoreRef(input.cwd, {
                branch: initialStatus.branch,
                upstreamRef: initialStatus.upstreamRef,
              })
            : null;

        let branchStep: { status: "created" | "skipped_not_requested"; name?: string };
        let commitMessageForStep = input.commitMessage;
        let preResolvedCommitSuggestion: CommitAndBranchSuggestion | undefined = undefined;

        if (input.featureBranch) {
          currentPhase = "branch";
          yield* progress.emit({
            kind: "phase_started",
            phase: "branch",
            label: "Preparing feature branch...",
          });
          const result = yield* runFeatureBranchStep(
            input.cwd,
            initialStatus.branch,
            input.commitMessage,
            input.filePaths,
            textGenerationParams,
            {
              allowCommittedHead: !wantsCommit,
              restoreOriginalBranchRef: committedHeadRestoreRef,
            },
          );
          branchStep = result.branchStep;
          commitMessageForStep = result.resolvedCommitMessage;
          preResolvedCommitSuggestion = result.resolvedCommitSuggestion;
        } else {
          branchStep = { status: "skipped_not_requested" as const };
        }

        const currentBranch = branchStep.name ?? initialStatus.branch;
        const commitAction = isCommitAction(input.action) ? input.action : null;
        const commit = commitAction
          ? yield* Effect.gen(function* () {
              currentPhase = "commit";
              return yield* runCommitStep(
                input.cwd,
                commitAction,
                currentBranch,
                commitMessageForStep,
                preResolvedCommitSuggestion,
                input.filePaths,
                textGenerationParams,
                options?.progressReporter,
                progress.actionId,
              );
            })
          : { status: "skipped_not_requested" as const };

        const push = wantsPush
          ? yield* progress
              .emit({
                kind: "phase_started",
                phase: "push",
                label: "Pushing...",
              })
              .pipe(
                Effect.flatMap(() =>
                  Effect.gen(function* () {
                    currentPhase = "push";
                    return yield* gitCore.pushCurrentBranch(input.cwd, currentBranch);
                  }),
                ),
              )
          : { status: "skipped_not_requested" as const };

        const pr = wantsPr
          ? yield* progress
              .emit({
                kind: "phase_started",
                phase: "pr",
                label: "Creating PR...",
              })
              .pipe(
                Effect.flatMap(() =>
                  Effect.gen(function* () {
                    currentPhase = "pr";
                    return yield* runPrStep(input.cwd, currentBranch, textGenerationParams);
                  }),
                ),
              )
          : { status: "skipped_not_requested" as const };

        const result = {
          action: input.action,
          branch: branchStep,
          commit,
          push,
          pr,
        };
        yield* progress.emit({
          kind: "action_finished",
          result,
        });
        return result;
      });

      return yield* runAction.pipe(
        Effect.catch((error) =>
          progress
            .emit({
              kind: "action_failed",
              phase: currentPhase,
              message: error.message,
            })
            .pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
      );
    },
  );

  return runStackedAction;
}
