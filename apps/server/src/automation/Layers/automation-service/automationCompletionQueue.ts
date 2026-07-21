import type {
  AutomationCompletionPolicy,
  AutomationDefinition,
  AutomationRun,
  AutomationRunStatus,
} from "@agent-group/contracts";
import { Cause, Effect, Option, Queue } from "effect";

import {
  completionPolicyForDefinition,
  runUsesCurrentCompletionPolicy,
} from "./automationDefinitionPolicy.ts";
import { makeAutomationCompletionEvaluator } from "./automationCompletionEvaluator.ts";
import type {
  AutomationRuntimeDependencies,
  PublishAutomationDefinition,
  PublishAutomationEvent,
  RequireAutomationProject,
} from "./automationServiceTypes.ts";
import { errorMessage, toServiceError } from "./automationServiceValues.ts";

const AUTOMATION_COMPLETION_EVALUATION_WORKERS = 2;
const AUTOMATION_COMPLETION_EVALUATION_QUEUE_CAPACITY = 100;

interface AutomationCompletionEvaluationJob {
  readonly definition: AutomationDefinition;
  readonly run: AutomationRun;
  readonly policy: Extract<AutomationCompletionPolicy, { type: "ai-evaluated" }>;
}

export function makeAutomationCompletionQueue(input: {
  readonly dependencies: AutomationRuntimeDependencies;
  readonly publish: PublishAutomationEvent;
  readonly publishDefinition: PublishAutomationDefinition;
  readonly requireProject: RequireAutomationProject;
}) {
  return Effect.gen(function* () {
    const { automationRepository } = input.dependencies;
    const evaluator = makeAutomationCompletionEvaluator(input);
    const queue = yield* Queue.bounded<AutomationCompletionEvaluationJob>(
      AUTOMATION_COMPLETION_EVALUATION_QUEUE_CAPACITY,
    );
    const queuedRunIds = new Set<string>();

    const enqueueJob = (job: AutomationCompletionEvaluationJob) =>
      Effect.sync(() => {
        if (queuedRunIds.has(job.run.id)) return "duplicate" as const;
        if (queuedRunIds.size >= AUTOMATION_COMPLETION_EVALUATION_QUEUE_CAPACITY)
          return "full" as const;
        queuedRunIds.add(job.run.id);
        return "queued" as const;
      }).pipe(
        Effect.flatMap((state) => {
          if (state === "duplicate") return Effect.void;
          if (state === "full") {
            return Effect.logWarning("automation completion evaluation queue at capacity", {
              automationId: job.definition.id,
              runId: job.run.id,
              capacity: AUTOMATION_COMPLETION_EVALUATION_QUEUE_CAPACITY,
            });
          }
          return Queue.offer(queue, job).pipe(Effect.asVoid);
        }),
      );

    const enqueueForRun = (run: AutomationRun) => {
      if (run.status !== "succeeded" || run.result?.completionEvaluation !== undefined)
        return Effect.void;
      return automationRepository.getDefinitionById({ id: run.automationId }).pipe(
        Effect.mapError(toServiceError("Failed to load automation.")),
        Effect.flatMap((definitionOption) =>
          Option.match(definitionOption, {
            onNone: () => Effect.void,
            onSome: (definition) => {
              const policy = completionPolicyForDefinition(definition);
              if (policy.type !== "ai-evaluated") return Effect.void;
              if (!evaluator.shouldUseStopPolicyForDefinition(definition, policy))
                return Effect.void;
              if (!runUsesCurrentCompletionPolicy(run, definition)) return Effect.void;
              return enqueueJob({ definition, run, policy });
            },
          }),
        ),
      );
    };

    const enqueuePendingCompletionEvaluations = () =>
      automationRepository.listRunsNeedingCompletionEvaluation({ limit: 100 }).pipe(
        Effect.mapError(toServiceError("Failed to list pending stop evaluations.")),
        Effect.flatMap((runs) => Effect.forEach(runs, enqueueForRun, { concurrency: 1 })),
        Effect.asVoid,
      );

    const processJob = (job: AutomationCompletionEvaluationJob) =>
      evaluator.evaluateCompletionPolicy(job.definition, job.run, job.policy).pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("automation completion evaluation worker failed", {
                automationId: job.definition.id,
                runId: job.run.id,
                cause: Cause.pretty(cause),
              }),
        ),
        Effect.ensuring(Effect.sync(() => queuedRunIds.delete(job.run.id))),
      );

    const worker = Effect.forever(
      Queue.take(queue).pipe(
        Effect.flatMap(processJob),
        Effect.flatMap(() =>
          enqueuePendingCompletionEvaluations().pipe(
            Effect.catch((error) =>
              Effect.logWarning("automation pending stop evaluations could not be requeued", {
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    );

    yield* Effect.forEach(
      Array.from({ length: AUTOMATION_COMPLETION_EVALUATION_WORKERS }),
      () => Effect.forkScoped(worker),
      { discard: true },
    );
    yield* enqueuePendingCompletionEvaluations().pipe(
      Effect.catch((error) =>
        Effect.logWarning("automation pending stop evaluations could not be queued", {
          error: errorMessage(error),
        }),
      ),
    );

    const maybeStopLoop = (run: AutomationRun, status: AutomationRunStatus, now: string) =>
      automationRepository.getDefinitionById({ id: run.automationId }).pipe(
        Effect.mapError(toServiceError("Failed to load automation.")),
        Effect.flatMap((definitionOption) =>
          Option.match(definitionOption, {
            onNone: () => Effect.void,
            onSome: (definition) => {
              if (definition.archivedAt || !definition.enabled) return Effect.void;
              const stopOnError = status === "failed" && definition.stopOnError;
              const reachedMax =
                definition.maxIterations !== null &&
                definition.iterationCount >= definition.maxIterations;
              const policy = completionPolicyForDefinition(definition);
              const enqueueAiStop =
                !reachedMax &&
                status === "succeeded" &&
                definition.mode === "heartbeat" &&
                policy.type === "ai-evaluated" &&
                runUsesCurrentCompletionPolicy(run, definition)
                  ? enqueueJob({ definition, run, policy })
                  : Effect.void;
              return enqueueAiStop.pipe(
                Effect.flatMap(() =>
                  !stopOnError && !reachedMax
                    ? Effect.void
                    : automationRepository.disableDefinition({ id: run.automationId, now }).pipe(
                        Effect.mapError(toServiceError("Failed to disable automation.")),
                        Effect.flatMap(() => input.publishDefinition(run.automationId)),
                      ),
                ),
              );
            },
          }),
        ),
      );

    return { maybeStopLoop, enqueuePendingCompletionEvaluations };
  });
}
