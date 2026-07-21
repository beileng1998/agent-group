import type {
  AutomationDefinition,
  AutomationRun,
  AutomationRunNowResult,
  ThreadId,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { AutomationServiceError } from "../../Errors.ts";
import type { AutomationServiceShape } from "../../Services/AutomationService.ts";
import { scheduledOccurrenceForDefinition } from "./automationDefinitionPolicy.ts";
import type {
  AutomationRuntimeDependencies,
  PublishAutomationDefinition,
  PublishAutomationEvent,
} from "./automationServiceTypes.ts";
import {
  errorMessage,
  isoNow,
  resultForRunStatus,
  SCHEDULER_LEASE_TTL_MS,
  toServiceError,
} from "./automationServiceValues.ts";

interface PendingRunResult {
  readonly run: AutomationRun;
  readonly inserted: boolean;
}

export function makeAutomationScheduler(input: {
  readonly dependencies: AutomationRuntimeDependencies;
  readonly publish: PublishAutomationEvent;
  readonly publishDefinition: PublishAutomationDefinition;
  readonly createPendingRun: (
    definition: AutomationDefinition,
    trigger: AutomationRun["trigger"],
    scheduledFor: string,
    now: string,
    options?: { readonly threadIdOverride?: ThreadId | null },
  ) => Effect.Effect<PendingRunResult, AutomationServiceError>;
  readonly heartbeatThreadRunState: (
    threadId: ThreadId,
  ) => Effect.Effect<
    { readonly activeRuns: number; readonly pendingCompletionEvaluations: number },
    AutomationServiceError
  >;
  readonly dispatchRun: (
    definition: AutomationDefinition,
    run: AutomationRun,
    now: string,
  ) => Effect.Effect<AutomationRunNowResult, AutomationServiceError>;
}) {
  const { automationRepository } = input.dependencies;
  const { publish, publishDefinition, createPendingRun, heartbeatThreadRunState, dispatchRun } =
    input;

  const markScheduledRunSkipped = (run: AutomationRun, reason: string, now: string) =>
    Effect.gen(function* () {
      const skipped = yield* automationRepository
        .markRunSkipped({ id: run.id, reason, finishedAt: now })
        .pipe(Effect.mapError(toServiceError("Failed to skip automation run.")));
      const withResult = yield* automationRepository
        .markRunResult({
          id: skipped.id,
          result: resultForRunStatus("skipped", { summary: reason, now }),
          updatedAt: now,
        })
        .pipe(Effect.mapError(toServiceError("Failed to update automation run result.")));
      yield* publish({ type: "run-upserted", run: withResult });
      return withResult;
    });

  const advanceScheduledDefinition = (
    definition: AutomationDefinition,
    nextRunAt: string | null,
    now: string,
  ) =>
    Effect.gen(function* () {
      if (definition.schedule.type === "once" && nextRunAt === null) {
        yield* automationRepository
          .disableDefinition({ id: definition.id, now })
          .pipe(Effect.mapError(toServiceError("Failed to complete one-shot automation.")));
      } else {
        yield* automationRepository
          .setDefinitionNextRunAt({ id: definition.id, nextRunAt, updatedAt: now })
          .pipe(Effect.mapError(toServiceError("Failed to advance automation schedule.")));
      }
      yield* publishDefinition(definition.id);
    });

  const runDueDefinition = (definition: AutomationDefinition, now: string) =>
    Effect.gen(function* () {
      if (
        definition.maxIterations !== null &&
        definition.iterationCount >= definition.maxIterations
      ) {
        yield* automationRepository
          .disableDefinition({ id: definition.id, now })
          .pipe(Effect.mapError(toServiceError("Failed to disable automation.")));
        yield* publishDefinition(definition.id);
        return Option.none<AutomationRunNowResult>();
      }
      const occurrence = scheduledOccurrenceForDefinition(definition, now);
      const { scheduledFor, nextRunAt } = occurrence;
      if (occurrence.skip) {
        const { run, inserted } = yield* createPendingRun(
          definition,
          { type: "scheduled" },
          scheduledFor,
          now,
          { threadIdOverride: null },
        );
        if (inserted) yield* markScheduledRunSkipped(run, "Scheduled occurrence was missed.", now);
        yield* advanceScheduledDefinition(definition, nextRunAt, now);
        return Option.none<AutomationRunNowResult>();
      }
      if (definition.mode === "heartbeat") {
        const targetThreadId = definition.targetThreadId;
        if (!targetThreadId) {
          return yield* Effect.fail(
            new AutomationServiceError({
              message: "Heartbeat automation has no target thread to continue.",
            }),
          );
        }
        const state = yield* heartbeatThreadRunState(targetThreadId);
        if (state.pendingCompletionEvaluations > 0) return Option.none<AutomationRunNowResult>();
        if (state.activeRuns > 0) {
          const reason = "Target thread already has an automation run in progress.";
          const { run, inserted } = yield* createPendingRun(
            definition,
            { type: "scheduled" },
            scheduledFor,
            now,
            { threadIdOverride: null },
          );
          if (inserted) yield* markScheduledRunSkipped(run, reason, now);
          yield* advanceScheduledDefinition(definition, nextRunAt, now);
          return Option.none<AutomationRunNowResult>();
        }
      }
      const { run, inserted } = yield* createPendingRun(
        definition,
        { type: "scheduled" },
        scheduledFor,
        now,
      );
      yield* advanceScheduledDefinition(definition, nextRunAt, now);
      if (!inserted) return Option.none<AutomationRunNowResult>();
      yield* automationRepository
        .incrementDefinitionIterationCount({ id: definition.id, now })
        .pipe(Effect.mapError(toServiceError("Failed to update automation iteration count.")));
      const result = yield* dispatchRun(definition, run, now).pipe(
        Effect.catch(() =>
          automationRepository.getRunById({ id: run.id }).pipe(
            Effect.mapError(toServiceError("Failed to load automation run.")),
            Effect.map((runOption) =>
              Option.match(runOption, {
                onNone: (): AutomationRunNowResult => ({ run }),
                onSome: (failed): AutomationRunNowResult => ({ run: failed }),
              }),
            ),
          ),
        ),
      );
      return Option.some(result);
    });

  const runDueOnce: AutomationServiceShape["runDueOnce"] = (runInput = {}) =>
    Effect.gen(function* () {
      const now = runInput.now ?? isoNow();
      const ownerId = runInput.leaseOwnerId ?? `automation-scheduler:${process.pid}`;
      const nowMs = Date.parse(now);
      const leaseExpiresAt = new Date(
        (Number.isFinite(nowMs) ? nowMs : Date.now()) + SCHEDULER_LEASE_TTL_MS,
      ).toISOString();
      const acquired = yield* automationRepository
        .tryAcquireSchedulerLease({
          leaseKey: "automation-scheduler",
          ownerId,
          now,
          leaseExpiresAt,
        })
        .pipe(Effect.mapError(toServiceError("Failed to acquire automation scheduler lease.")));
      if (!acquired) {
        yield* Effect.logDebug("automation scheduler lease not acquired", { ownerId });
        return [];
      }
      const definitions = yield* automationRepository
        .listDueDefinitions({
          now,
          limit: runInput.limit ?? 5,
        })
        .pipe(Effect.mapError(toServiceError("Failed to list due automations.")));
      const results = yield* Effect.forEach(
        definitions,
        (definition) =>
          runDueDefinition(definition, now).pipe(
            Effect.catch((error) =>
              Effect.logWarning("automation scheduled run failed", {
                automationId: definition.id,
                error: errorMessage(error),
              }).pipe(Effect.as(Option.none<AutomationRunNowResult>())),
            ),
          ),
        { concurrency: 1 },
      );
      return results.filter(Option.isSome).map((result) => result.value);
    });

  return { runDueOnce };
}
