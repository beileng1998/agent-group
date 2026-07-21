import type { ProviderRuntimeEvent, ThreadId } from "@agent-group/contracts";
import { Effect, Exit } from "effect";

import type { ProviderRuntimeIdleLifecycle } from "./providerServiceTypes.ts";

const DEFAULT_PROVIDER_RUNTIME_IDLE_STOP_MS = 10 * 60 * 1000;
const configuredProviderRuntimeIdleStopMs =
  process.env.AGENT_GROUP_PROVIDER_RUNTIME_IDLE_STOP_MS ??
  process.env.AGENT_GROUP_PROVIDER_RUNTIME_IDLE_STOP_MS;
const PROVIDER_RUNTIME_IDLE_STOP_MS = Number.isFinite(Number(configuredProviderRuntimeIdleStopMs))
  ? Math.max(0, Number(configuredProviderRuntimeIdleStopMs))
  : DEFAULT_PROVIDER_RUNTIME_IDLE_STOP_MS;

export function resolveProviderRuntimeIdleStopMs(override?: number): number {
  return Math.max(0, override ?? PROVIDER_RUNTIME_IDLE_STOP_MS);
}

export function makeProviderRuntimeIdleLifecycle(
  runtimeIdleStopMs: number,
): ProviderRuntimeIdleLifecycle {
  const runtimeIdleTimers = new Map<ThreadId, ReturnType<typeof setTimeout>>();
  // Fired idle callbacks outlive their timer map entry, so generations
  // invalidate asynchronous stop work when new user work starts in that gap.
  const runtimeIdleGenerations = new Map<ThreadId, symbol>();
  const runtimeIdleStopsInFlight = new Map<ThreadId, Promise<void>>();
  let stopHandler: ((threadId: ThreadId, generation: symbol) => void) | null = null;

  const invalidateGeneration = (threadId: ThreadId): symbol => {
    const generation = Symbol(String(threadId));
    runtimeIdleGenerations.set(threadId, generation);
    return generation;
  };

  const isGenerationCurrent = (threadId: ThreadId, generation: symbol): boolean =>
    runtimeIdleGenerations.get(threadId) === generation;

  const retireGeneration = (threadId: ThreadId, generation?: symbol): void => {
    if (generation === undefined || isGenerationCurrent(threadId, generation)) {
      runtimeIdleGenerations.delete(threadId);
    }
  };

  const clearTimer = (threadId: ThreadId): void => {
    invalidateGeneration(threadId);
    const timer = runtimeIdleTimers.get(threadId);
    if (!timer) return;
    clearTimeout(timer);
    runtimeIdleTimers.delete(threadId);
  };

  const scheduleStop = (threadId: ThreadId): void => {
    clearTimer(threadId);
    if (runtimeIdleStopMs <= 0) {
      retireGeneration(threadId);
      return;
    }

    const generation = invalidateGeneration(threadId);
    const timer = setTimeout(() => {
      runtimeIdleTimers.delete(threadId);
      stopHandler?.(threadId, generation);
    }, runtimeIdleStopMs);
    timer.unref();
    runtimeIdleTimers.set(threadId, timer);
  };

  const waitForStop = (threadId: ThreadId): Effect.Effect<void> =>
    Effect.promise(() => runtimeIdleStopsInFlight.get(threadId) ?? Promise.resolve());

  const runSensitiveWork = <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
    options?: { readonly scheduleIdleStopOnSuccess?: boolean },
  ): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const existingIdleStop = runtimeIdleStopsInFlight.get(threadId);
      const displacedIdleStop = existingIdleStop !== undefined || runtimeIdleTimers.has(threadId);
      const waitForExistingIdleStop =
        existingIdleStop !== undefined ? Effect.promise(() => existingIdleStop) : Effect.void;
      return waitForExistingIdleStop.pipe(
        Effect.tap(() => Effect.sync(() => clearTimer(threadId))),
        Effect.flatMap(() => waitForStop(threadId)),
        Effect.flatMap(() => effect),
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? options?.scheduleIdleStopOnSuccess === true
              ? Effect.sync(() => scheduleStop(threadId))
              : Effect.void
            : displacedIdleStop
              ? Effect.sync(() => scheduleStop(threadId))
              : Effect.sync(() => retireGeneration(threadId)),
        ),
      );
    });

  const reconcileEvent = (event: ProviderRuntimeEvent): void => {
    switch (event.type) {
      case "turn.started":
        clearTimer(event.threadId);
        return;
      case "session.started":
      case "thread.started":
      case "turn.completed":
      case "turn.aborted":
        scheduleStop(event.threadId);
        return;
      case "thread.state.changed":
        if (
          event.payload.state === "compacted" ||
          event.payload.state === "archived" ||
          event.payload.state === "closed"
        ) {
          scheduleStop(event.threadId);
        }
        return;
      case "session.exited":
        clearTimer(event.threadId);
        retireGeneration(event.threadId);
        return;
    }
  };

  const trackStop = (threadId: ThreadId, stopEffect: Effect.Effect<void>): void => {
    const stopPromise = Effect.runPromise(stopEffect).finally(() => {
      if (runtimeIdleStopsInFlight.get(threadId) === stopPromise) {
        runtimeIdleStopsInFlight.delete(threadId);
      }
    });
    runtimeIdleStopsInFlight.set(threadId, stopPromise);
  };

  const dispose = (): void => {
    for (const timer of runtimeIdleTimers.values()) clearTimeout(timer);
    runtimeIdleTimers.clear();
    runtimeIdleGenerations.clear();
    runtimeIdleStopsInFlight.clear();
    stopHandler = null;
  };

  return {
    clearTimer,
    scheduleStop,
    waitForStop,
    runSensitiveWork,
    reconcileEvent,
    isGenerationCurrent,
    retireGeneration,
    setStopHandler: (handler) => {
      stopHandler = handler;
    },
    trackStop,
    dispose,
  };
}
