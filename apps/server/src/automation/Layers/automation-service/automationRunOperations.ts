import type {
  AutomationDefinition,
  AutomationRun,
  AutomationRunNowResult,
  ThreadId,
} from "@agent-group/contracts";
import { Effect } from "effect";

import { AutomationServiceError } from "../../Errors.ts";
import type { AutomationServiceShape } from "../../Services/AutomationService.ts";
import { computeNextAutomationRunAtAfter } from "../../schedule.ts";
import { makePermissionSnapshot } from "./automationDefinitionPolicy.ts";
import type {
  AutomationRuntimeDependencies,
  PublishAutomationEvent,
  RequireAutomationDefinition,
} from "./automationServiceTypes.ts";
import {
  deriveAutomationRunIds,
  isoNow,
  makeAutomationRunId,
  toServiceError,
} from "./automationServiceValues.ts";

export function makeAutomationRunOperations(input: {
  readonly dependencies: AutomationRuntimeDependencies;
  readonly publish: PublishAutomationEvent;
  readonly requireDefinition: RequireAutomationDefinition;
  readonly validateSchedulePolicy: (input: {
    readonly schedule: AutomationDefinition["schedule"];
    readonly enabled: boolean;
    readonly maxIterations: AutomationDefinition["maxIterations"];
    readonly minimumIntervalSeconds: number;
    readonly acknowledgedRisks: readonly string[];
    readonly now: string;
  }) => Effect.Effect<void, AutomationServiceError>;
  readonly dispatchRun: (
    definition: AutomationDefinition,
    run: AutomationRun,
    now: string,
  ) => Effect.Effect<AutomationRunNowResult, AutomationServiceError>;
  readonly cancelRunById: (input: {
    readonly runId: AutomationRun["id"];
  }) => Effect.Effect<AutomationRun, AutomationServiceError>;
}) {
  const { automationRepository } = input.dependencies;
  const { publish, requireDefinition, validateSchedulePolicy, dispatchRun, cancelRunById } = input;

  const createPendingRun = (
    definition: AutomationDefinition,
    trigger: AutomationRun["trigger"],
    scheduledFor: string,
    now: string,
    options: { readonly threadIdOverride?: ThreadId | null } = {},
  ) =>
    Effect.gen(function* () {
      const runId = makeAutomationRunId();
      const ids = deriveAutomationRunIds(runId);
      const threadId =
        "threadIdOverride" in options
          ? options.threadIdOverride
          : definition.mode === "heartbeat"
            ? definition.targetThreadId
            : ids.threadId;
      const run = yield* automationRepository
        .createRun({
          id: runId,
          automationId: definition.id,
          projectId: definition.projectId,
          threadId,
          messageId: ids.messageId,
          threadCreateCommandId: definition.mode === "heartbeat" ? null : ids.threadCreateCommandId,
          turnStartCommandId: ids.turnStartCommandId,
          trigger,
          scheduledFor,
          permissionSnapshot: makePermissionSnapshot(definition, now),
          now,
        })
        .pipe(Effect.mapError(toServiceError("Failed to create automation run.")));
      yield* publish({ type: "run-upserted", run });
      return { run, inserted: run.id === runId };
    });

  const heartbeatThreadRunState = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const activeRuns = yield* automationRepository
        .countActiveRunsForThread({ threadId })
        .pipe(Effect.mapError(toServiceError("Failed to count active automation runs.")));
      const pendingCompletionEvaluations = yield* automationRepository
        .countPendingCompletionEvaluationsForThread({ threadId })
        .pipe(
          Effect.mapError(toServiceError("Failed to count pending automation stop evaluations.")),
        );
      return { activeRuns, pendingCompletionEvaluations };
    });

  const restartExhaustedBoundedDefinition = (definition: AutomationDefinition, now: string) =>
    Effect.gen(function* () {
      if (
        definition.maxIterations === null ||
        definition.iterationCount < definition.maxIterations
      ) {
        return definition;
      }
      const computedNextRunAt =
        definition.schedule.type === "manual"
          ? null
          : computeNextAutomationRunAtAfter(definition.schedule, now, now);
      let canBecomeEnabled = false;
      if (definition.schedule.type === "manual" || computedNextRunAt !== null) {
        canBecomeEnabled = yield* validateSchedulePolicy({
          schedule: definition.schedule,
          enabled: true,
          maxIterations: definition.maxIterations,
          minimumIntervalSeconds: definition.minimumIntervalSeconds,
          acknowledgedRisks: definition.acknowledgedRisks,
          now,
        }).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );
      }
      const enabled = canBecomeEnabled;
      const nextRunAt = enabled ? computedNextRunAt : null;
      const restarted = { ...definition, enabled, iterationCount: 0, nextRunAt, updatedAt: now };
      return yield* automationRepository
        .restartDefinitionLoop({
          id: definition.id,
          enabled,
          nextRunAt,
          updatedAt: now,
        })
        .pipe(
          Effect.mapError(toServiceError("Failed to restart automation loop.")),
          Effect.as(restarted),
          Effect.tap((updated) => publish({ type: "definition-upserted", definition: updated })),
        );
    });

  const runNow: AutomationServiceShape["runNow"] = (runInput) =>
    Effect.gen(function* () {
      const definition = yield* requireDefinition(runInput.automationId);
      const now = isoNow();
      if (definition.mode === "heartbeat") {
        if (!definition.targetThreadId) {
          return yield* Effect.fail(
            new AutomationServiceError({
              message: "Heartbeat automation has no target thread to continue.",
            }),
          );
        }
        const state = yield* heartbeatThreadRunState(definition.targetThreadId);
        if (state.activeRuns > 0) {
          return yield* Effect.fail(
            new AutomationServiceError({ message: "This thread already has a run in progress." }),
          );
        }
        if (state.pendingCompletionEvaluations > 0) {
          return yield* Effect.fail(
            new AutomationServiceError({
              message: "This thread already has a stop check in progress.",
            }),
          );
        }
      }
      const runnableDefinition = yield* restartExhaustedBoundedDefinition(definition, now);
      const { run, inserted } = yield* createPendingRun(
        runnableDefinition,
        { type: "manual" },
        now,
        now,
      );
      if (!inserted) {
        return yield* Effect.fail(
          new AutomationServiceError({ message: "This thread already has a run in progress." }),
        );
      }
      yield* automationRepository
        .incrementDefinitionIterationCount({ id: runnableDefinition.id, now })
        .pipe(Effect.mapError(toServiceError("Failed to update automation iteration count.")));
      return yield* dispatchRun(runnableDefinition, run, now);
    });

  const deleteAutomation: AutomationServiceShape["delete"] = (deleteInput) =>
    Effect.gen(function* () {
      const activeRuns = yield* automationRepository
        .listActiveRunsForDefinition({ automationId: deleteInput.id })
        .pipe(Effect.mapError(toServiceError("Failed to load active automation runs.")));
      yield* Effect.forEach(
        activeRuns,
        (run) => cancelRunById({ runId: run.id }).pipe(Effect.catch(() => Effect.void)),
        { concurrency: 1 },
      );
      yield* automationRepository
        .archiveDefinition({ id: deleteInput.id, archivedAt: isoNow() })
        .pipe(Effect.mapError(toServiceError("Failed to delete automation.")));
      yield* publish({ type: "definition-deleted", automationId: deleteInput.id });
    });

  const cancelRun: AutomationServiceShape["cancelRun"] = (cancelInput) =>
    cancelRunById(cancelInput).pipe(Effect.map((run) => ({ run })));

  const markRunRead: AutomationServiceShape["markRunRead"] = (markInput) =>
    automationRepository.markRunRead({ ...markInput, now: isoNow() }).pipe(
      Effect.mapError(toServiceError("Failed to update automation run.")),
      Effect.tap((run) => publish({ type: "run-upserted", run })),
      Effect.map((run) => ({ run })),
    );

  const archiveRun: AutomationServiceShape["archiveRun"] = (archiveInput) =>
    automationRepository.archiveRun({ ...archiveInput, now: isoNow() }).pipe(
      Effect.mapError(toServiceError("Failed to update automation run.")),
      Effect.tap((run) => publish({ type: "run-upserted", run })),
      Effect.map((run) => ({ run })),
    );

  return {
    createPendingRun,
    heartbeatThreadRunState,
    deleteAutomation,
    runNow,
    cancelRun,
    markRunRead,
    archiveRun,
  };
}
