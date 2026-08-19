import {
  type CommandId,
  type OrchestrationEvent,
  type OrchestrationSession,
  type OrchestrationThread,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Cause, Duration, Effect, Queue, Stream } from "effect";

import { activeThreadGoal, buildGoalContinuationInput } from "../../provider/providerGoalMode.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import type { ProviderTurnDispatchInput } from "./providerTurnPreparation.ts";
import type { ProviderTurnQueue } from "./providerTurnQueue.ts";

type GoalRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.goal-continuation-requested" }
>;
type MetaUpdatedEvent = Extract<OrchestrationEvent, { type: "thread.meta-updated" }>;
type InteractionModeEvent = Extract<OrchestrationEvent, { type: "thread.interaction-mode-set" }>;
type BlockedContinuation = Pick<
  GoalRequestedEvent["payload"],
  "goalStartedAt" | "trigger" | "sourceTurnId"
>;

function isCurrentActiveGoal(
  thread: OrchestrationThread | undefined,
  expectedGoalStartedAt: string | null,
): thread is OrchestrationThread {
  return Boolean(
    thread &&
    thread.deletedAt == null &&
    thread.archivedAt == null &&
    thread.parentThreadId == null &&
    activeThreadGoal(thread) &&
    (thread.goalStartedAt ?? null) === expectedGoalStartedAt,
  );
}

function isCurrentRunnableGoal(
  thread: OrchestrationThread | undefined,
  expectedGoalStartedAt: string | null,
): thread is OrchestrationThread {
  return isCurrentActiveGoal(thread, expectedGoalStartedAt) && thread.interactionMode !== "plan";
}

function hasProjectedGoalBlocker(thread: OrchestrationThread): boolean {
  return Boolean(
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.session?.status === "starting" ||
    thread.session?.status === "running",
  );
}

export function makeProviderGoalContinuation<Environment>(dependencies: {
  readonly orchestrationEngine: Pick<OrchestrationEngineShape, "dispatch" | "getReadModel">;
  readonly turnQueue: ProviderTurnQueue;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, unknown, Environment>;
  readonly hasLiveProviderTurn: (
    threadId: ThreadId,
  ) => Effect.Effect<boolean, unknown, Environment>;
  readonly drainQueuedTurnsForThread: (
    threadId: ThreadId,
  ) => Effect.Effect<unknown, unknown, Environment>;
  readonly dispatchTurnForThread: (
    input: ProviderTurnDispatchInput,
  ) => Effect.Effect<TurnId | undefined, unknown, Environment>;
  readonly setThreadSession: (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, unknown, Environment>;
  readonly setThreadSessionError: (input: {
    readonly threadId: ThreadId;
    readonly detail: string;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, unknown, Environment>;
  readonly interruptProviderTurn: (input: {
    readonly threadId: ThreadId;
    readonly turnId?: TurnId;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, unknown, Environment>;
  readonly serverCommandId: (tag: string) => CommandId;
}) {
  return Effect.gen(function* () {
    const blockedContinuations = new Map<ThreadId, BlockedContinuation>();
    const queuedRetries = new Set<ThreadId>();
    const retryQueue = yield* Queue.unbounded<ThreadId>();

    const requestContinuation = (input: {
      readonly threadId: ThreadId;
      readonly goalStartedAt: string | null;
      readonly trigger: GoalRequestedEvent["payload"]["trigger"];
      readonly sourceTurnId?: TurnId;
      readonly createdAt: string;
    }) =>
      dependencies.orchestrationEngine.dispatch({
        type: "thread.goal.continue",
        commandId: dependencies.serverCommandId("goal-continue"),
        ...input,
      });

    const pauseGoal = Effect.fnUntraced(function* (
      threadId: ThreadId,
      expectedGoalStartedAt: string | null,
    ) {
      const thread = yield* dependencies.resolveThread(threadId);
      if (!isCurrentActiveGoal(thread, expectedGoalStartedAt)) return;
      yield* dependencies.orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: dependencies.serverCommandId("goal-auto-pause"),
        threadId,
        goalPaused: true,
      });
    });

    const processMetaUpdated = (event: MetaUpdatedEvent) => {
      if (
        event.payload.goalStartBehavior === "defer" ||
        event.payload.goalStartedAt == null ||
        event.payload.goalPausedAt !== null
      ) {
        return Effect.void;
      }
      return requestContinuation({
        threadId: event.payload.threadId,
        goalStartedAt: event.payload.goalStartedAt,
        trigger: "goal-updated",
        createdAt: event.payload.updatedAt,
      });
    };

    const processInteractionModeUpdated = Effect.fnUntraced(function* (
      event: InteractionModeEvent,
    ) {
      if (event.payload.interactionMode === "plan") {
        blockedContinuations.delete(event.payload.threadId);
        return;
      }
      if (event.payload.previousInteractionMode !== "plan") return;
      const thread = yield* dependencies.resolveThread(event.payload.threadId);
      if (!thread || !activeThreadGoal(thread)) return;
      yield* requestContinuation({
        threadId: thread.id,
        goalStartedAt: thread.goalStartedAt ?? null,
        trigger: "interaction-mode-updated",
        createdAt: event.payload.updatedAt,
      });
    });

    const runContinuation = Effect.fnUntraced(function* (event: GoalRequestedEvent) {
      const thread = yield* dependencies.resolveThread(event.payload.threadId);
      if (!isCurrentRunnableGoal(thread, event.payload.goalStartedAt)) return "stale" as const;
      if (hasProjectedGoalBlocker(thread) || (yield* dependencies.hasLiveProviderTurn(thread.id))) {
        return "blocked" as const;
      }

      yield* dependencies.drainQueuedTurnsForThread(thread.id);
      if (dependencies.turnQueue.hasPending(thread.id)) return "blocked" as const;

      const createdAt = event.payload.createdAt;
      const providerName = thread.session?.providerName ?? thread.modelSelection.provider;
      yield* dependencies.setThreadSession({
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "starting",
          providerName,
          runtimeMode: thread.session?.runtimeMode ?? thread.runtimeMode,
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      });

      const turnId = yield* dependencies.dispatchTurnForThread({
        threadId: thread.id,
        messageId: `goal-continuation:${event.eventId}`,
        messageText: buildGoalContinuationInput(),
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        dispatchMode: "queue",
        turnKind: "goal-continuation",
        createdAt,
      });
      if (!turnId) throw new Error("Provider did not accept the goal continuation.");

      const latest = yield* dependencies.resolveThread(thread.id);
      if (!isCurrentRunnableGoal(latest, event.payload.goalStartedAt)) {
        yield* dependencies.interruptProviderTurn({
          threadId: thread.id,
          turnId,
          createdAt: new Date().toISOString(),
        });
      }
      return "started" as const;
    });

    const scheduleRetry = Effect.fnUntraced(function* (threadId: ThreadId) {
      if (queuedRetries.has(threadId)) return;
      queuedRetries.add(threadId);
      yield* Queue.offer(retryQueue, threadId);
    });

    const deferContinuation = Effect.fnUntraced(function* (event: GoalRequestedEvent) {
      blockedContinuations.set(event.payload.threadId, {
        goalStartedAt: event.payload.goalStartedAt,
        trigger: event.payload.trigger,
        ...(event.payload.sourceTurnId !== undefined
          ? { sourceTurnId: event.payload.sourceTurnId }
          : {}),
      });
      yield* scheduleRetry(event.payload.threadId);
    });

    const retryBlockedContinuation = Effect.fnUntraced(function* (threadId: ThreadId) {
      const pending = blockedContinuations.get(threadId);
      if (!pending) return;
      const thread = yield* dependencies.resolveThread(threadId);
      if (!isCurrentRunnableGoal(thread, pending.goalStartedAt)) {
        blockedContinuations.delete(threadId);
        return;
      }
      if (hasProjectedGoalBlocker(thread) || (yield* dependencies.hasLiveProviderTurn(threadId))) {
        yield* scheduleRetry(threadId);
        return;
      }
      yield* dependencies.drainQueuedTurnsForThread(threadId);
      if (dependencies.turnQueue.hasPending(threadId)) {
        yield* scheduleRetry(threadId);
        return;
      }
      if (blockedContinuations.get(threadId) !== pending) return;

      blockedContinuations.delete(threadId);
      yield* dependencies.orchestrationEngine
        .dispatch({
          type: "thread.goal.continue",
          commandId: dependencies.serverCommandId("goal-blocker-cleared"),
          threadId,
          goalStartedAt: pending.goalStartedAt,
          trigger: pending.trigger,
          ...(pending.sourceTurnId !== undefined ? { sourceTurnId: pending.sourceTurnId } : {}),
          createdAt: new Date().toISOString(),
        })
        .pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.sync(() => {
                  if (!blockedContinuations.has(threadId)) {
                    blockedContinuations.set(threadId, pending);
                  }
                }).pipe(Effect.andThen(scheduleRetry(threadId))),
          ),
        );
    });

    const retryAfterDelay = (threadId: ThreadId) =>
      Effect.sleep(Duration.millis(500)).pipe(
        Effect.andThen(Effect.sync(() => queuedRetries.delete(threadId))),
        Effect.andThen(retryBlockedContinuation(threadId)),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : scheduleRetry(threadId).pipe(
                Effect.andThen(
                  Effect.logWarning("provider goal continuation retry failed", {
                    threadId,
                    cause: Cause.pretty(cause),
                  }),
                ),
              ),
        ),
      );

    const runRetries = Stream.fromQueue(retryQueue).pipe(
      Stream.runForEach((threadId) => retryAfterDelay(threadId).pipe(Effect.forkScoped)),
      Effect.asVoid,
    );

    const clearBlockedContinuation = (event: GoalRequestedEvent) =>
      Effect.sync(() => {
        const pending = blockedContinuations.get(event.payload.threadId);
        if (pending?.goalStartedAt === event.payload.goalStartedAt) {
          blockedContinuations.delete(event.payload.threadId);
        }
      });

    const processRequested = (event: GoalRequestedEvent) =>
      Effect.gen(function* () {
        const outcome = yield* runContinuation(event);
        if (outcome === "blocked") {
          yield* deferContinuation(event);
          return;
        }
        yield* clearBlockedContinuation(event);
      }).pipe(
        Effect.timeout("110 seconds"),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.gen(function* () {
                const thread = yield* dependencies.resolveThread(event.payload.threadId);
                if (!isCurrentActiveGoal(thread, event.payload.goalStartedAt)) return;
                yield* dependencies.setThreadSessionError({
                  threadId: event.payload.threadId,
                  detail: Cause.pretty(cause),
                  createdAt: new Date().toISOString(),
                });
                yield* pauseGoal(event.payload.threadId, event.payload.goalStartedAt);
              }),
        ),
      );

    const recoverActiveGoals = Effect.gen(function* () {
      const snapshot = yield* dependencies.orchestrationEngine.getReadModel();
      yield* Effect.forEach(
        snapshot.threads.filter(
          (thread) =>
            thread.deletedAt == null &&
            thread.archivedAt == null &&
            thread.parentThreadId == null &&
            thread.interactionMode !== "plan" &&
            Boolean(activeThreadGoal(thread)),
        ),
        (thread) =>
          requestContinuation({
            threadId: thread.id,
            goalStartedAt: thread.goalStartedAt ?? null,
            trigger: "startup-recovery",
            createdAt: new Date().toISOString(),
          }),
        { discard: true },
      );
    });

    return {
      processMetaUpdated,
      processInteractionModeUpdated,
      processRequested,
      recoverActiveGoals,
      runRetries,
    };
  });
}
