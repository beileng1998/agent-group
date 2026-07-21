import type { OrchestrationEvent, ProviderRuntimeEvent } from "@agent-group/contracts";
import { Cause, Effect, Stream } from "effect";
import { makeDrainableWorker } from "@agent-group/shared/DrainableWorker";

import type { CheckpointStoreError } from "../../../checkpointing/Errors.ts";
import type { ProviderServiceShape } from "../../../provider/Services/ProviderService.ts";
import type { OrchestrationDispatchError } from "../../Errors.ts";
import type { CheckpointReactorShape } from "../../Services/CheckpointReactor.ts";
import type { OrchestrationEngineShape } from "../../Services/OrchestrationEngine.ts";
import type { CheckpointCaptureHandlers } from "./checkpointCaptureHandlers.ts";
import type { CheckpointReactorInput, CheckpointReactorState } from "./checkpointReactorValues.ts";
import { toTurnId } from "./checkpointReactorValues.ts";
import type { CheckpointRestoreHandler } from "./checkpointRestoreHandler.ts";
import type { CheckpointStatus } from "./checkpointStatus.ts";
import type { CheckpointTurnStartHandlers } from "./checkpointTurnStartHandlers.ts";

export interface CheckpointReactorRuntimeDependencies {
  readonly capture: CheckpointCaptureHandlers;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly providerService: ProviderServiceShape;
  readonly restore: CheckpointRestoreHandler;
  readonly state: CheckpointReactorState;
  readonly status: CheckpointStatus;
  readonly turnStart: CheckpointTurnStartHandlers;
}

export function makeCheckpointReactorRuntime(dependencies: CheckpointReactorRuntimeDependencies) {
  const { capture, orchestrationEngine, providerService, restore, state, status, turnStart } =
    dependencies;

  return Effect.gen(function* () {
    const supportsLiveTurnDiffPatch = Effect.fnUntraced(function* (
      provider: ProviderRuntimeEvent["provider"],
    ) {
      const capabilities = yield* providerService
        .getCapabilities(provider)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      return capabilities?.supportsLiveTurnDiffPatch === true;
    });

    const processDomainEvent = Effect.fnUntraced(function* (event: OrchestrationEvent) {
      if (event.type === "thread.turn-start-requested" || event.type === "thread.message-sent") {
        yield* turnStart.ensurePreTurnBaselineFromDomainTurnStart(event);
        return;
      }

      if (event.type === "thread.checkpoint-revert-requested") {
        yield* restore(event).pipe(
          Effect.catch((error) =>
            status.appendRevertFailureActivity({
              threadId: event.payload.threadId,
              turnCount: event.payload.turnCount,
              detail: error.message,
              createdAt: new Date().toISOString(),
            }),
          ),
        );
        return;
      }

      if (event.type === "thread.turn-diff-completed") {
        yield* capture.captureCheckpointFromPlaceholder(event);
      }
    });

    const processRuntimeEvent = Effect.fnUntraced(function* (event: ProviderRuntimeEvent) {
      if (event.type === "turn.started") {
        yield* turnStart.ensurePreTurnBaselineFromTurnStart(event);
        return;
      }

      if (event.type === "item.completed") {
        state.liveDiffScheduledThreads.delete(event.threadId);
        yield* capture.captureLiveTurnDiff(event);
        return;
      }

      if (event.type === "turn.completed") {
        const turnId = toTurnId(event.turnId);
        yield* capture.captureCheckpointFromTurnCompletion(event).pipe(
          Effect.catch((error) =>
            status
              .appendCaptureFailureActivity({
                threadId: event.threadId,
                turnId,
                detail: error.message,
                createdAt: new Date().toISOString(),
              })
              .pipe(Effect.catch(() => Effect.void)),
          ),
        );
      }
    });

    const processInput = (
      input: CheckpointReactorInput,
    ): Effect.Effect<void, CheckpointStoreError | OrchestrationDispatchError, never> =>
      input.source === "domain"
        ? processDomainEvent(input.event)
        : processRuntimeEvent(input.event);

    const processInputSafely = (input: CheckpointReactorInput) =>
      processInput(input).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning("checkpoint reactor failed to process input", {
            source: input.source,
            eventType: input.event.type,
            cause: Cause.pretty(cause),
          });
        }),
      );

    const worker = yield* makeDrainableWorker(processInputSafely);
    const start: CheckpointReactorShape["start"] = Effect.gen(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (
            event.type !== "thread.turn-start-requested" &&
            event.type !== "thread.message-sent" &&
            event.type !== "thread.checkpoint-revert-requested" &&
            event.type !== "thread.turn-diff-completed"
          ) {
            return Effect.void;
          }
          return worker.enqueue({ source: "domain", event });
        }),
      );

      yield* Effect.forkScoped(
        Stream.runForEach(providerService.streamEvents, (event) => {
          if (event.type === "turn.started" || event.type === "turn.completed") {
            return worker.enqueue({ source: "runtime", event });
          }
          if (event.type === "item.completed" && event.payload.itemType === "file_change") {
            return Effect.gen(function* () {
              if (state.liveDiffScheduledThreads.has(event.threadId)) {
                return;
              }
              if (yield* supportsLiveTurnDiffPatch(event.provider)) {
                return;
              }
              state.liveDiffScheduledThreads.add(event.threadId);
              yield* worker.enqueue({ source: "runtime", event });
            });
          }
          return Effect.void;
        }),
      );
    });

    return {
      start,
      drain: worker.drain,
    } satisfies CheckpointReactorShape;
  });
}
