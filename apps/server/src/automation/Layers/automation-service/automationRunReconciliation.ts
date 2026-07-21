import type {
  AutomationDefinition,
  AutomationRun,
  OrchestrationThreadShell,
  ThreadId,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";

import type { ProjectionTurn } from "../../../persistence/Services/ProjectionTurns.ts";
import type { AutomationServiceError } from "../../Errors.ts";
import type { AutomationServiceShape } from "../../Services/AutomationService.ts";
import { hasExceededMaxRuntime, runUsesExistingThread } from "./automationDefinitionPolicy.ts";
import type {
  AutomationRuntimeDependencies,
  MaybeStopAutomationLoop,
  PublishAutomationEvent,
} from "./automationServiceTypes.ts";
import {
  errorMessage,
  isoNow,
  isTerminalRunStatus,
  makeAutomationCommandId,
  recoveryErrorMessage,
  resultForRunStatus,
  toServiceError,
} from "./automationServiceValues.ts";

export function makeAutomationRunReconciliation(input: {
  readonly dependencies: AutomationRuntimeDependencies;
  readonly publish: PublishAutomationEvent;
  readonly maybeStopLoop: MaybeStopAutomationLoop;
  readonly enqueuePendingCompletionEvaluations: () => Effect.Effect<void, AutomationServiceError>;
}) {
  const {
    automationRepository,
    orchestrationEngine,
    projectionSnapshotQuery,
    projectionTurnRepository,
  } = input.dependencies;
  const { publish, maybeStopLoop, enqueuePendingCompletionEvaluations } = input;

  const resolveRunTurn = (
    run: AutomationRun,
    shell: OrchestrationThreadShell,
  ): Effect.Effect<
    ProjectionTurn | OrchestrationThreadShell["latestTurn"] | null,
    AutomationServiceError
  > => {
    if (!runUsesExistingThread(run)) return Effect.succeed(shell.latestTurn);
    if (!run.threadId || !run.messageId) return Effect.succeed(null);
    if (run.turnId) {
      return projectionTurnRepository
        .getByTurnId({ threadId: run.threadId, turnId: run.turnId })
        .pipe(
          Effect.mapError(toServiceError("Failed to load automation turn.")),
          Effect.map((turnOption) =>
            Option.match(turnOption, { onNone: () => null, onSome: (turn) => turn }),
          ),
        );
    }
    return projectionTurnRepository.listByThreadId({ threadId: run.threadId }).pipe(
      Effect.mapError(toServiceError("Failed to list automation turns.")),
      Effect.map((turns) => turns.find((turn) => turn.pendingMessageId === run.messageId) ?? null),
    );
  };

  const runTurnOwnsPendingInput = (
    run: AutomationRun,
    shell: OrchestrationThreadShell,
    turn: ProjectionTurn | OrchestrationThreadShell["latestTurn"] | null,
  ) =>
    !runUsesExistingThread(run) ||
    (turn?.turnId !== null &&
      turn?.turnId !== undefined &&
      shell.latestTurn?.turnId === turn.turnId);

  const interruptRunForRecovery = (run: AutomationRun, now: string) =>
    automationRepository.markRunInterrupted({ id: run.id, turnId: null, finishedAt: now }).pipe(
      Effect.flatMap((interrupted) =>
        interrupted.status !== "interrupted"
          ? Effect.succeed(interrupted)
          : automationRepository
              .markRunResult({
                id: interrupted.id,
                result: resultForRunStatus("interrupted", {
                  summary: "Automation run was interrupted during recovery.",
                  now,
                }),
                updatedAt: now,
              })
              .pipe(Effect.orElseSucceed(() => interrupted)),
      ),
      Effect.tap((updated) => publish({ type: "run-upserted", run: updated })),
    );

  const interruptRunBestEffort = (run: AutomationRun, now: string) => {
    if (!run.threadId) return Effect.void;
    return orchestrationEngine
      .dispatch({
        type: "thread.turn.interrupt",
        commandId: makeAutomationCommandId(run.id, "interrupt"),
        threadId: run.threadId,
        ...(run.turnId ? { turnId: run.turnId } : {}),
        createdAt: now,
      })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("automation run interrupt failed", {
            runId: run.id,
            threadId: run.threadId,
            error: errorMessage(error),
          }),
        ),
        Effect.asVoid,
      );
  };

  const cancelRunById = (cancelInput: { readonly runId: AutomationRun["id"] }) =>
    Effect.gen(function* () {
      const now = isoNow();
      const run = yield* automationRepository
        .cancelRun({ ...cancelInput, now })
        .pipe(Effect.mapError(toServiceError("Failed to cancel automation run.")));
      if (run.status !== "cancelled") {
        yield* publish({ type: "run-upserted", run });
        return run;
      }
      const withResult = yield* automationRepository
        .markRunResult({
          id: run.id,
          result: resultForRunStatus("cancelled", {
            summary: "Automation run was cancelled.",
            now,
          }),
          updatedAt: now,
        })
        .pipe(Effect.mapError(toServiceError("Failed to update automation run result.")));
      yield* interruptRunBestEffort(withResult, now);
      yield* publish({ type: "run-upserted", run: withResult });
      return withResult;
    });

  const reconcileThread: AutomationServiceShape["reconcileThread"] = ({ threadId }) =>
    Effect.gen(function* () {
      const runOption = yield* automationRepository
        .getRunByThreadId({ threadId })
        .pipe(Effect.mapError(toServiceError("Failed to load automation run for thread.")));
      if (Option.isNone(runOption)) return;
      const run = runOption.value;
      if (isTerminalRunStatus(run.status)) return;
      const shellOption = yield* projectionSnapshotQuery
        .getThreadShellById(threadId)
        .pipe(Effect.mapError(toServiceError("Failed to load automation thread state.")));
      if (Option.isNone(shellOption)) return;
      const shell = shellOption.value;
      const turn = yield* resolveRunTurn(run, shell);
      const now = isoNow();

      if (
        (shell.hasPendingApprovals === true || shell.hasPendingUserInput === true) &&
        runTurnOwnsPendingInput(run, shell, turn)
      ) {
        if (run.status !== "waiting-for-approval") {
          const updated = yield* automationRepository
            .markRunWaitingForApproval({
              id: run.id,
              turnId: turn?.turnId ?? null,
              updatedAt: now,
            })
            .pipe(Effect.mapError(toServiceError("Failed to update automation run.")));
          const withResult = yield* automationRepository
            .markRunResult({
              id: updated.id,
              result: resultForRunStatus("waiting-for-approval", {
                summary: "Automation run is waiting for input or approval.",
                now,
              }),
              updatedAt: now,
            })
            .pipe(Effect.mapError(toServiceError("Failed to update automation run result.")));
          yield* publish({ type: "run-upserted", run: withResult });
        }
        return;
      }

      if (!turn || turn.turnId === null || turn.state === "pending" || turn.state === "running") {
        if (
          run.status === "waiting-for-approval" &&
          run.threadId &&
          run.messageId &&
          run.turnStartCommandId &&
          runTurnOwnsPendingInput(run, shell, turn)
        ) {
          const running = yield* automationRepository
            .markRunStarted({
              id: run.id,
              threadId: run.threadId,
              messageId: run.messageId,
              threadCreateCommandId: run.threadCreateCommandId,
              turnStartCommandId: run.turnStartCommandId,
              startedAt: run.startedAt ?? now,
            })
            .pipe(Effect.mapError(toServiceError("Failed to update automation run.")));
          const cleared = yield* automationRepository
            .markRunResult({
              id: running.id,
              result: null,
              updatedAt: now,
            })
            .pipe(Effect.mapError(toServiceError("Failed to update automation run result.")));
          yield* publish({ type: "run-upserted", run: cleared });
        }
        return;
      }

      let updated: AutomationRun;
      if (turn.state === "completed") {
        updated = yield* automationRepository
          .markRunSucceeded({
            id: run.id,
            turnId: turn.turnId,
            result: resultForRunStatus("succeeded", { now }),
            finishedAt: turn.completedAt ?? now,
          })
          .pipe(Effect.mapError(toServiceError("Failed to update automation run.")));
      } else if (turn.state === "error") {
        const summary = errorMessage(shell.session?.lastError ?? "Automation turn failed.");
        updated = yield* automationRepository
          .markRunFailed({ id: run.id, error: summary, finishedAt: now })
          .pipe(Effect.mapError(toServiceError("Failed to update automation run.")));
        updated = yield* automationRepository
          .markRunResult({
            id: updated.id,
            result: resultForRunStatus("failed", { summary, now }),
            updatedAt: now,
          })
          .pipe(Effect.mapError(toServiceError("Failed to update automation run result.")));
      } else {
        updated = yield* automationRepository
          .markRunInterrupted({ id: run.id, turnId: turn.turnId, finishedAt: now })
          .pipe(Effect.mapError(toServiceError("Failed to update automation run.")));
        updated = yield* automationRepository
          .markRunResult({
            id: updated.id,
            result: resultForRunStatus("interrupted", {
              summary: "Automation run was interrupted.",
              now,
            }),
            updatedAt: now,
          })
          .pipe(Effect.mapError(toServiceError("Failed to update automation run result.")));
      }
      yield* publish({ type: "run-upserted", run: updated });
      yield* maybeStopLoop(updated, updated.status, now);
    });

  const failRunForTimeout = (definition: AutomationDefinition, run: AutomationRun, now: string) =>
    Effect.gen(function* () {
      const summary = `Automation run exceeded its ${definition.maxRuntimeSeconds}-second runtime limit.`;
      yield* interruptRunBestEffort(run, now);
      const failed = yield* automationRepository
        .markRunFailed({ id: run.id, error: summary, finishedAt: now })
        .pipe(Effect.mapError(toServiceError("Failed to time out automation run.")));
      if (failed.status !== "failed") {
        yield* publish({ type: "run-upserted", run: failed });
        return;
      }
      const withResult = yield* automationRepository
        .markRunResult({
          id: failed.id,
          result: resultForRunStatus("failed", { summary, now }),
          updatedAt: now,
        })
        .pipe(Effect.mapError(toServiceError("Failed to update automation run result.")));
      yield* publish({ type: "run-upserted", run: withResult });
      yield* maybeStopLoop(withResult, "failed", now);
    });

  const reconcileActiveRun = (run: AutomationRun, now: string) =>
    automationRepository.getDefinitionById({ id: run.automationId }).pipe(
      Effect.mapError(toServiceError("Failed to load automation.")),
      Effect.flatMap((definitionOption) =>
        Option.match(definitionOption, {
          onNone: () => Effect.void,
          onSome: (definition) =>
            hasExceededMaxRuntime(definition, run, now)
              ? failRunForTimeout(definition, run, now)
              : run.threadId
                ? reconcileThread({ threadId: run.threadId })
                : Effect.void,
        }),
      ),
    );

  const reconcileActiveRuns: AutomationServiceShape["reconcileActiveRuns"] = () =>
    automationRepository.listRecoverableRuns({ limit: 100 }).pipe(
      Effect.mapError(toServiceError("Failed to list active automation runs.")),
      Effect.flatMap((runs) =>
        Effect.forEach(
          runs,
          (run) =>
            reconcileActiveRun(run, isoNow()).pipe(
              Effect.catch((error) =>
                Effect.logWarning("automation active-run reconcile failed", {
                  automationId: run.automationId,
                  runId: run.id,
                  error: recoveryErrorMessage(error),
                }),
              ),
            ),
          { concurrency: 1 },
        ),
      ),
      Effect.flatMap(() => enqueuePendingCompletionEvaluations()),
      Effect.asVoid,
    );

  const recoverPendingRuns: AutomationServiceShape["recoverPendingRuns"] = () =>
    automationRepository.listRecoverableRuns({ limit: 200 }).pipe(
      Effect.mapError(toServiceError("Failed to list recoverable automation runs.")),
      Effect.flatMap((runs) =>
        Effect.forEach(
          runs,
          (run) => {
            const now = isoNow();
            const threadId = run.threadId;
            if (!threadId) {
              return interruptRunForRecovery(run, now).pipe(
                Effect.mapError(toServiceError("Failed to recover automation run.")),
                Effect.asVoid,
                Effect.catch((error) =>
                  Effect.logWarning("automation orphaned-run recovery failed", {
                    automationId: run.automationId,
                    runId: run.id,
                    error: recoveryErrorMessage(error),
                  }),
                ),
              );
            }
            return projectionSnapshotQuery.getThreadShellById(threadId).pipe(
              Effect.mapError(toServiceError("Failed to load automation thread state.")),
              Effect.flatMap((shellOption) =>
                Option.isNone(shellOption)
                  ? interruptRunForRecovery(run, now).pipe(
                      Effect.mapError(toServiceError("Failed to recover automation run.")),
                      Effect.asVoid,
                    )
                  : resolveRunTurn(run, shellOption.value).pipe(
                      Effect.flatMap((turn) =>
                        turn === null
                          ? interruptRunForRecovery(run, now).pipe(
                              Effect.mapError(toServiceError("Failed to recover automation run.")),
                              Effect.asVoid,
                            )
                          : reconcileThread({ threadId }),
                      ),
                    ),
              ),
              Effect.catch((error) =>
                Effect.logWarning("automation pending-run recovery failed", {
                  automationId: run.automationId,
                  runId: run.id,
                  error: recoveryErrorMessage(error),
                }),
              ),
            );
          },
          { concurrency: 1 },
        ),
      ),
      Effect.flatMap(() => enqueuePendingCompletionEvaluations()),
      Effect.asVoid,
    );

  return {
    cancelRunById,
    interruptRunBestEffort,
    reconcileThread,
    reconcileActiveRuns,
    recoverPendingRuns,
  };
}
