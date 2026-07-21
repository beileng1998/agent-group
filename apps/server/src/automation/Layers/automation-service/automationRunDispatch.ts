import {
  type AutomationDefinition,
  type AutomationRun,
  type AutomationRunId,
  type AutomationRunNowResult,
  type CommandId,
  type OrchestrationProjectShell,
  type ThreadId,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { AutomationServiceError } from "../../Errors.ts";
import {
  resultForRunStatus,
  deriveAutomationRunIds,
  errorMessage,
  isoNow,
  localThreadEnvironment,
  makeAutomationBranchName,
  toServiceError,
} from "./automationServiceValues.ts";
import type {
  AutomationRuntimeDependencies,
  AutomationThreadEnvironment,
  MaybeStopAutomationLoop,
  PublishAutomationEvent,
  RequireAutomationProject,
} from "./automationServiceTypes.ts";

export function makeAutomationRunDispatch(input: {
  readonly dependencies: AutomationRuntimeDependencies;
  readonly publish: PublishAutomationEvent;
  readonly requireProject: RequireAutomationProject;
  readonly validateRiskAcknowledgements: (input: {
    readonly runtimeMode: AutomationDefinition["runtimeMode"];
    readonly worktreeMode: AutomationDefinition["worktreeMode"];
    readonly acknowledgedRisks: readonly string[];
  }) => Effect.Effect<void, AutomationServiceError>;
  readonly validateFastIntervalPolicy: (input: {
    readonly schedule: AutomationDefinition["schedule"];
    readonly enabled: boolean;
    readonly maxIterations: AutomationDefinition["maxIterations"];
    readonly acknowledgedRisks: readonly string[];
    readonly now: string;
  }) => Effect.Effect<void, AutomationServiceError>;
  readonly maybeStopLoop: MaybeStopAutomationLoop;
}) {
  const { automationRepository, git, orchestrationEngine } = input.dependencies;
  const {
    publish,
    requireProject,
    validateRiskAcknowledgements,
    validateFastIntervalPolicy,
    maybeStopLoop,
  } = input;

  const cleanupUnattachedWorktree = (cleanupInput: {
    readonly definition: AutomationDefinition;
    readonly run: AutomationRun;
    readonly project: OrchestrationProjectShell;
    readonly environment: AutomationThreadEnvironment;
    readonly reason: string;
  }) => {
    const path = cleanupInput.environment.associatedWorktreePath;
    if (cleanupInput.environment.envMode !== "worktree" || !path) return Effect.void;
    const expectedBranch = makeAutomationBranchName(cleanupInput.definition, cleanupInput.run.id);
    const branch =
      cleanupInput.environment.associatedWorktreeBranch === expectedBranch ? expectedBranch : null;
    const removeWorktree = git
      .removeWorktree({ cwd: cleanupInput.project.workspaceRoot, path, force: true })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("automation unattached worktree cleanup failed", {
            automationId: cleanupInput.definition.id,
            runId: cleanupInput.run.id,
            path,
            reason: cleanupInput.reason,
            error: errorMessage(error),
          }),
        ),
        Effect.asVoid,
      );
    const deleteBranch = branch
      ? git.deleteBranch({ cwd: cleanupInput.project.workspaceRoot, branch, force: true }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("automation unattached branch cleanup failed", {
              automationId: cleanupInput.definition.id,
              runId: cleanupInput.run.id,
              branch,
              reason: cleanupInput.reason,
              error: errorMessage(error),
            }),
          ),
          Effect.asVoid,
        )
      : Effect.void;
    return removeWorktree.pipe(Effect.flatMap(() => deleteBranch));
  };

  const resolveThreadEnvironment = (
    definition: AutomationDefinition,
    project: OrchestrationProjectShell,
    runId: AutomationRunId,
    beforeWorktreeCreate: () => Effect.Effect<void, AutomationServiceError> = () => Effect.void,
  ): Effect.Effect<AutomationThreadEnvironment, AutomationServiceError> => {
    const requireLocalCheckoutAcknowledgement = () =>
      definition.acknowledgedRisks.includes("local-checkout")
        ? Effect.void
        : Effect.fail(
            new AutomationServiceError({
              message: "Automation local checkout fallback requires an explicit acknowledgement.",
            }),
          );
    if (definition.worktreeMode === "local") {
      return requireLocalCheckoutAcknowledgement().pipe(Effect.as(localThreadEnvironment));
    }
    return git.statusDetails(project.workspaceRoot).pipe(
      Effect.mapError(toServiceError("Failed to inspect project Git status.")),
      Effect.flatMap((status) => {
        if (!status.isRepo || !status.branch) {
          return definition.worktreeMode === "worktree"
            ? Effect.fail(
                new AutomationServiceError({
                  message:
                    "Automation requires a Git worktree, but the project is not on a branch.",
                }),
              )
            : requireLocalCheckoutAcknowledgement().pipe(Effect.as(localThreadEnvironment));
        }
        const currentBranch = status.branch;
        const branch = makeAutomationBranchName(definition, runId);
        return beforeWorktreeCreate().pipe(
          Effect.flatMap(() =>
            git
              .createWorktree({
                cwd: project.workspaceRoot,
                branch: currentBranch,
                newBranch: branch,
                path: null,
              })
              .pipe(
                Effect.mapError(toServiceError("Failed to create automation worktree.")),
                Effect.map(
                  (result): AutomationThreadEnvironment => ({
                    envMode: "worktree",
                    branch: result.worktree.branch,
                    worktreePath: result.worktree.path,
                    associatedWorktreePath: result.worktree.path,
                    associatedWorktreeBranch: result.worktree.branch,
                    associatedWorktreeRef: result.worktree.branch,
                  }),
                ),
              ),
          ),
        );
      }),
      Effect.catch((error) =>
        definition.worktreeMode === "auto"
          ? requireLocalCheckoutAcknowledgement().pipe(Effect.as(localThreadEnvironment))
          : Effect.fail(error),
      ),
    );
  };

  const dispatchRun = (
    definition: AutomationDefinition,
    run: AutomationRun,
    now: string,
  ): Effect.Effect<AutomationRunNowResult, AutomationServiceError> =>
    Effect.gen(function* () {
      const plannedIds = deriveAutomationRunIds(run.id);
      const plannedThreadId = definition.mode === "heartbeat" ? run.threadId : plannedIds.threadId;
      const messageId = run.messageId;
      const turnStartCommandId = run.turnStartCommandId;
      if (!plannedThreadId || !messageId || !turnStartCommandId) {
        return yield* Effect.fail(
          new AutomationServiceError({
            message: "Automation run is missing planned dispatch references.",
          }),
        );
      }

      yield* validateRiskAcknowledgements({
        runtimeMode: definition.runtimeMode,
        worktreeMode: definition.worktreeMode,
        acknowledgedRisks: definition.acknowledgedRisks,
      });
      yield* validateFastIntervalPolicy({
        schedule: definition.schedule,
        enabled: definition.enabled,
        maxIterations: definition.maxIterations,
        acknowledgedRisks: definition.acknowledgedRisks,
        now,
      });

      const stopIfRunCannotDispatch = (latest: AutomationRun, detail: string) =>
        latest.status === "running"
          ? Effect.succeed(latest)
          : publish({ type: "run-upserted", run: latest }).pipe(
              Effect.flatMap(() => Effect.fail(new AutomationServiceError({ message: detail }))),
            );
      const markRunDispatchStarted = (
        threadId: ThreadId,
        threadCreateCommandId: CommandId | null,
      ) =>
        automationRepository
          .markRunStarted({
            id: run.id,
            threadId,
            messageId,
            threadCreateCommandId,
            turnStartCommandId,
            startedAt: now,
          })
          .pipe(
            Effect.mapError(toServiceError("Failed to update automation run.")),
            Effect.tap((started) => publish({ type: "run-upserted", run: started })),
            Effect.flatMap((started) =>
              stopIfRunCannotDispatch(
                started,
                "Automation run was cancelled before dispatch started.",
              ),
            ),
          );
      const requireRunStillDispatching = (detail: string) =>
        automationRepository.getRunById({ id: run.id }).pipe(
          Effect.mapError(toServiceError("Failed to load automation run.")),
          Effect.flatMap((runOption) =>
            Option.match(runOption, {
              onNone: () =>
                Effect.fail(
                  new AutomationServiceError({ message: "Automation run no longer exists." }),
                ),
              onSome: (latest) => stopIfRunCannotDispatch(latest, detail),
            }),
          ),
        );

      if (definition.mode === "heartbeat") {
        const targetThreadId = definition.targetThreadId;
        if (!targetThreadId) {
          return yield* Effect.fail(
            new AutomationServiceError({
              message: "Heartbeat automation has no target thread to continue.",
            }),
          );
        }
        const started = yield* markRunDispatchStarted(targetThreadId, null);
        yield* requireRunStillDispatching(
          "Automation run was cancelled before continuing the thread.",
        );
        yield* orchestrationEngine
          .dispatch({
            type: "thread.turn.start",
            commandId: turnStartCommandId,
            threadId: targetThreadId,
            message: { messageId, role: "user", text: definition.prompt, attachments: [] },
            modelSelection: definition.modelSelection,
            ...(definition.providerOptions ? { providerOptions: definition.providerOptions } : {}),
            dispatchMode: "queue",
            dispatchOrigin: "automation",
            runtimeMode: definition.runtimeMode,
            interactionMode: definition.interactionMode,
            createdAt: now,
          })
          .pipe(Effect.mapError(toServiceError("Failed to continue automation thread.")));
        return { run: started };
      }

      const project = yield* requireProject(definition.projectId);
      const threadCreateCommandId = run.threadCreateCommandId;
      if (!threadCreateCommandId) {
        return yield* Effect.fail(
          new AutomationServiceError({
            message: "Standalone automation run is missing its planned thread command.",
          }),
        );
      }
      const started = yield* markRunDispatchStarted(plannedThreadId, threadCreateCommandId);
      const environment = yield* resolveThreadEnvironment(definition, project, run.id, () =>
        requireRunStillDispatching(
          "Automation run was cancelled before creating the automation worktree.",
        ).pipe(Effect.asVoid),
      );
      yield* requireRunStillDispatching(
        "Automation run was cancelled before creating the automation thread.",
      ).pipe(
        Effect.catch((error) =>
          cleanupUnattachedWorktree({
            definition,
            run,
            project,
            environment,
            reason: "cancelled-before-thread-create",
          }).pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
      );
      yield* orchestrationEngine
        .dispatch({
          type: "thread.create",
          commandId: threadCreateCommandId,
          threadId: plannedThreadId,
          projectId: definition.projectId,
          title: `${definition.name} - ${now}`,
          modelSelection: definition.modelSelection,
          runtimeMode: definition.runtimeMode,
          interactionMode: definition.interactionMode,
          envMode: environment.envMode,
          branch: environment.branch,
          worktreePath: environment.worktreePath,
          associatedWorktreePath: environment.associatedWorktreePath,
          associatedWorktreeBranch: environment.associatedWorktreeBranch,
          associatedWorktreeRef: environment.associatedWorktreeRef,
          createdAt: now,
        })
        .pipe(
          Effect.mapError(toServiceError("Failed to create automation thread.")),
          Effect.catch((error) =>
            cleanupUnattachedWorktree({
              definition,
              run,
              project,
              environment,
              reason: "thread-create-failed",
            }).pipe(Effect.flatMap(() => Effect.fail(error))),
          ),
        );
      yield* requireRunStillDispatching(
        "Automation run was cancelled before starting the automation turn.",
      );
      yield* orchestrationEngine
        .dispatch({
          type: "thread.turn.start",
          commandId: turnStartCommandId,
          threadId: plannedThreadId,
          message: { messageId, role: "user", text: definition.prompt, attachments: [] },
          modelSelection: definition.modelSelection,
          ...(definition.providerOptions ? { providerOptions: definition.providerOptions } : {}),
          dispatchMode: "queue",
          dispatchOrigin: "automation",
          runtimeMode: definition.runtimeMode,
          interactionMode: definition.interactionMode,
          createdAt: now,
        })
        .pipe(Effect.mapError(toServiceError("Failed to start automation turn.")));
      return { run: started };
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const failedAt = isoNow();
          const summary = errorMessage(error);
          const failed = yield* automationRepository
            .markRunFailed({ id: run.id, error: summary, finishedAt: failedAt })
            .pipe(Effect.mapError(toServiceError("Failed to update automation run.")));
          if (failed.status !== "failed") {
            yield* publish({ type: "run-upserted", run: failed });
            return yield* Effect.fail(error);
          }
          const withResult = yield* automationRepository
            .markRunResult({
              id: failed.id,
              result: resultForRunStatus("failed", { summary, now: failedAt }),
              updatedAt: failedAt,
            })
            .pipe(Effect.mapError(toServiceError("Failed to update automation run result.")));
          yield* publish({ type: "run-upserted", run: withResult });
          yield* maybeStopLoop(withResult, "failed", failedAt);
          return yield* Effect.fail(error);
        }).pipe(Effect.catch(() => Effect.fail(error))),
      ),
    );

  return { dispatchRun };
}
