import { Effect } from "effect";
import type { GitActionProgressEvent } from "@agent-group/contracts";
import { sanitizeFeatureBranchName } from "@agent-group/shared/git";
import type { GitActionProgressReporter } from "../../Services/GitManager.ts";
import type { GitCoreShape } from "../../Services/GitCore.ts";
import type { TextGenerationShape } from "../../Services/TextGeneration.ts";
import { buildGitTextGenerationCallInput } from "../../textGenerationSelection.ts";
import {
  createFallbackCommitSuggestion,
  formatCommitMessage,
  limitContext,
  parseCustomCommitMessage,
  sanitizeCommitMessage,
  sanitizeProgressText,
} from "./commitSuggestionValues.ts";
import type {
  CommitAndBranchSuggestion,
  GitActionProgressPayload,
  GitTextGenerationParams,
} from "./gitManagerTypes.ts";

const COMMIT_TIMEOUT_MS = 10 * 60_000;

export function makeCommitOperations(deps: {
  gitCore: GitCoreShape;
  textGeneration: TextGenerationShape;
}) {
  const { gitCore, textGeneration } = deps;
  const resolveCommitAndBranchSuggestion = (
    input: {
      cwd: string;
      branch: string | null;
      commitMessage?: string;
      /** When true, also produce a semantic feature branch name. */
      includeBranch?: boolean;
      filePaths?: readonly string[];
    } & GitTextGenerationParams,
  ) =>
    Effect.gen(function* () {
      const context = yield* gitCore.prepareCommitContext(input.cwd, input.filePaths);
      if (!context) {
        return null;
      }

      const customCommit = parseCustomCommitMessage(input.commitMessage ?? "");
      if (customCommit) {
        return {
          subject: customCommit.subject,
          body: customCommit.body,
          ...(input.includeBranch
            ? { branch: sanitizeFeatureBranchName(customCommit.subject) }
            : {}),
          commitMessage: formatCommitMessage(customCommit.subject, customCommit.body),
        };
      }

      const generated = yield* textGeneration
        .generateCommitMessage({
          cwd: input.cwd,
          branch: input.branch,
          stagedSummary: limitContext(context.stagedSummary, 8_000),
          stagedPatch: limitContext(context.stagedPatch, 50_000),
          ...(input.includeBranch ? { includeBranch: true } : {}),
          ...buildGitTextGenerationCallInput(input),
        })
        .pipe(
          Effect.map((result) => sanitizeCommitMessage(result)),
          Effect.catchTag("TextGenerationError", (error) =>
            Effect.logWarning(
              `GitManager.resolveCommitAndBranchSuggestion: falling back to heuristic commit message in ${input.cwd}: ${error.message}`,
            ).pipe(
              Effect.as(
                createFallbackCommitSuggestion({
                  stagedSummary: context.stagedSummary,
                  ...(input.includeBranch ? { includeBranch: true } : {}),
                }),
              ),
            ),
          ),
        );

      return {
        subject: generated.subject,
        body: generated.body,
        ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
        commitMessage: formatCommitMessage(generated.subject, generated.body),
      };
    });

  const runCommitStep = (
    cwd: string,
    action: "commit" | "commit_push" | "commit_push_pr",
    branch: string | null,
    commitMessage?: string,
    preResolvedSuggestion?: CommitAndBranchSuggestion,
    filePaths?: readonly string[],
    textGenerationParams?: GitTextGenerationParams,
    progressReporter?: GitActionProgressReporter,
    actionId?: string,
  ) =>
    Effect.gen(function* () {
      const emit = (event: GitActionProgressPayload) =>
        progressReporter && actionId
          ? progressReporter.publish({
              actionId,
              cwd,
              action,
              ...event,
            } as GitActionProgressEvent)
          : Effect.void;

      let suggestion: CommitAndBranchSuggestion | null | undefined = preResolvedSuggestion;
      if (!suggestion) {
        const needsGeneration = !commitMessage?.trim();
        if (needsGeneration) {
          yield* emit({
            kind: "phase_started",
            phase: "commit",
            label: "Generating commit message...",
          });
        }
        suggestion = yield* resolveCommitAndBranchSuggestion({
          cwd,
          branch,
          ...(commitMessage ? { commitMessage } : {}),
          ...(filePaths ? { filePaths } : {}),
          ...(textGenerationParams ?? {}),
        });
      }
      if (!suggestion) {
        return { status: "skipped_no_changes" as const };
      }

      yield* emit({
        kind: "phase_started",
        phase: "commit",
        label: "Committing...",
      });

      let currentHookName: string | null = null;
      const commitProgress =
        progressReporter && actionId
          ? {
              onOutputLine: ({ stream, text }: { stream: "stdout" | "stderr"; text: string }) => {
                const sanitized = sanitizeProgressText(text);
                if (!sanitized) {
                  return Effect.void;
                }
                return emit({
                  kind: "hook_output",
                  hookName: currentHookName,
                  stream,
                  text: sanitized,
                });
              },
              onHookStarted: (hookName: string) => {
                currentHookName = hookName;
                return emit({
                  kind: "hook_started",
                  hookName,
                });
              },
              onHookFinished: ({
                hookName,
                exitCode,
                durationMs,
              }: {
                hookName: string;
                exitCode: number | null;
                durationMs: number | null;
              }) => {
                if (currentHookName === hookName) {
                  currentHookName = null;
                }
                return emit({
                  kind: "hook_finished",
                  hookName,
                  exitCode,
                  durationMs,
                });
              },
            }
          : null;
      const { commitSha } = yield* gitCore.commit(cwd, suggestion.subject, suggestion.body, {
        timeoutMs: COMMIT_TIMEOUT_MS,
        ...(commitProgress ? { progress: commitProgress } : {}),
      });
      if (currentHookName !== null) {
        yield* emit({
          kind: "hook_finished",
          hookName: currentHookName,
          exitCode: 0,
          durationMs: null,
        });
        currentHookName = null;
      }
      return {
        status: "created" as const,
        commitSha,
        subject: suggestion.subject,
      };
    });

  return { resolveCommitAndBranchSuggestion, runCommitStep };
}
