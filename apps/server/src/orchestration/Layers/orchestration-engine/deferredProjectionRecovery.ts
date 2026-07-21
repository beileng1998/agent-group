import type { OrchestrationEvent } from "@agent-group/contracts";
import { Cause, Effect, Ref, Scope, Semaphore } from "effect";

import type { OrchestrationProjectionPipelineShape } from "../../Services/ProjectionPipeline.ts";

export const makeDeferredProjectionRecovery = Effect.fn(function* (input: {
  readonly projectionPipeline: OrchestrationProjectionPipelineShape;
  readonly maintenanceLock: Semaphore.Semaphore;
}) {
  const dirty = yield* Ref.make(false);
  const catchUpInFlight = yield* Ref.make(false);
  const catchUpScope = yield* Scope.make("sequential");

  const scheduleCatchUp = Effect.fn(function* (event: OrchestrationEvent) {
    const shouldStart = yield* Ref.modify(
      catchUpInFlight,
      (inFlight): readonly [boolean, boolean] => [!inFlight, true],
    );
    if (!shouldStart) return;

    yield* Effect.logWarning("scheduling deferred orchestration projection catch-up").pipe(
      Effect.annotateLogs({ eventType: event.type, sequence: event.sequence }),
    );
    yield* input.maintenanceLock
      .withPermits(1)(
        input.projectionPipeline.bootstrap.pipe(
          Effect.tap(() => Ref.set(dirty, false)),
          Effect.tap(() =>
            Effect.log("deferred orchestration projection catch-up completed").pipe(
              Effect.annotateLogs({ eventType: event.type, sequence: event.sequence }),
            ),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("deferred orchestration projection catch-up failed").pipe(
              Effect.annotateLogs({
                eventType: event.type,
                sequence: event.sequence,
                cause: Cause.pretty(cause),
              }),
            ),
          ),
          Effect.ensuring(Ref.set(catchUpInFlight, false)),
        ),
      )
      .pipe(Effect.forkIn(catchUpScope), Effect.asVoid);
  });

  const projectCommittedEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
    Effect.forEach(
      events,
      (event) =>
        Effect.gen(function* () {
          if (yield* Ref.get(dirty)) {
            yield* scheduleCatchUp(event);
            return;
          }

          const outcome = yield* input.projectionPipeline.projectDeferredEvent(event).pipe(
            Effect.matchCause({
              onFailure: (cause) => ({ _tag: "failure" as const, cause }),
              onSuccess: () => ({ _tag: "success" as const }),
            }),
          );
          if (outcome._tag === "success") return;

          yield* Ref.set(dirty, true);
          yield* Effect.logWarning("deferred orchestration projector failed", {
            sequence: event.sequence,
            eventType: event.type,
            cause: Cause.pretty(outcome.cause),
          });
          yield* scheduleCatchUp(event);
        }),
      { concurrency: 1 },
    ).pipe(Effect.asVoid);

  return { projectCommittedEvents } as const;
});
