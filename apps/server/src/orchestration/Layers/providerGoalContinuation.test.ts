import {
  CommandId,
  EventId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
} from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ProviderTurnQueue } from "./providerTurnQueue";
import { makeProviderGoalContinuation } from "./providerGoalContinuation";

const threadId = ThreadId.makeUnsafe("thread-goal");
const turnId = TurnId.makeUnsafe("turn-goal");
const startedAt = "2026-08-15T00:00:00.000Z";

function activeThread(patch: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: threadId,
    goal: "Ship the feature",
    goalStartedAt: startedAt,
    goalPausedAt: null,
    parentThreadId: null,
    archivedAt: null,
    deletedAt: null,
    interactionMode: "default",
    runtimeMode: "full-access",
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    session: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...patch,
  } as OrchestrationThread;
}

function requestedEvent() {
  return {
    type: "thread.goal-continuation-requested",
    eventId: EventId.makeUnsafe("event-goal-continue"),
    payload: {
      threadId,
      goalStartedAt: startedAt,
      trigger: "turn-completed",
      createdAt: startedAt,
    },
  } as never;
}

describe("provider goal continuation", () => {
  it("starts an internal continuation only when the root thread is idle", async () => {
    let thread = activeThread();
    const dispatchedTurns: unknown[] = [];
    const sessions: unknown[] = [];
    const continuation = await Effect.runPromise(makeProviderGoalContinuation({
      orchestrationEngine: {
        dispatch: () => Effect.void,
        getReadModel: () => Effect.succeed({ threads: [thread] } as never),
      },
      turnQueue: new ProviderTurnQueue(),
      resolveThread: () => Effect.succeed(thread),
      hasLiveProviderTurn: () => Effect.succeed(false),
      drainQueuedTurnsForThread: () => Effect.void,
      dispatchTurnForThread: (input) =>
        Effect.sync(() => {
          dispatchedTurns.push(input);
          return turnId;
        }),
      setThreadSession: (input) => Effect.sync(() => sessions.push(input)),
      setThreadSessionError: () => Effect.void,
      interruptProviderTurn: () => Effect.void,
      serverCommandId: (tag) => CommandId.makeUnsafe(`server:${tag}`),
    }));

    await Effect.runPromise(continuation.processRequested(requestedEvent()));
    expect(sessions).toHaveLength(1);
    expect(dispatchedTurns).toMatchObject([
      { threadId, turnKind: "goal-continuation", dispatchMode: "queue" },
    ]);

    thread = activeThread({ hasPendingUserInput: true });
    await Effect.runPromise(continuation.processRequested(requestedEvent()));
    expect(dispatchedTurns).toHaveLength(1);
  });

  it("rejects stale goal generations", async () => {
    let dispatchCount = 0;
    const continuation = await Effect.runPromise(makeProviderGoalContinuation({
      orchestrationEngine: {
        dispatch: () => Effect.void,
        getReadModel: () => Effect.succeed({ threads: [] } as never),
      },
      turnQueue: new ProviderTurnQueue(),
      resolveThread: () => Effect.succeed(activeThread({ goalStartedAt: `${startedAt}-new` })),
      hasLiveProviderTurn: () => Effect.succeed(false),
      drainQueuedTurnsForThread: () => Effect.void,
      dispatchTurnForThread: () => Effect.sync(() => { dispatchCount += 1; return turnId; }),
      setThreadSession: () => Effect.void,
      setThreadSessionError: () => Effect.void,
      interruptProviderTurn: () => Effect.void,
      serverCommandId: (tag) => CommandId.makeUnsafe(`server:${tag}`),
    }));

    await Effect.runPromise(continuation.processRequested(requestedEvent()));
    expect(dispatchCount).toBe(0);
  });

  it("retries once after a transient thread blocker clears", async () => {
    let thread = activeThread({ hasPendingUserInput: true });
    const commands: Array<{ readonly type: string }> = [];
    const continuation = await Effect.runPromise(
      makeProviderGoalContinuation({
        orchestrationEngine: {
          dispatch: (command) => Effect.sync(() => commands.push(command)),
          getReadModel: () => Effect.succeed({ threads: [thread] } as never),
        },
        turnQueue: new ProviderTurnQueue(),
        resolveThread: () => Effect.succeed(thread),
        hasLiveProviderTurn: () => Effect.succeed(false),
        drainQueuedTurnsForThread: () => Effect.void,
        dispatchTurnForThread: () => Effect.succeed(turnId),
        setThreadSession: () => Effect.void,
        setThreadSessionError: () => Effect.void,
        interruptProviderTurn: () => Effect.void,
        serverCommandId: (tag) => CommandId.makeUnsafe(`server:${tag}`),
      }),
    );

    await Effect.runPromise(continuation.processRequested(requestedEvent()));
    expect(commands).toEqual([]);
    thread = activeThread();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* continuation.runRetries.pipe(Effect.forkScoped);
          yield* Effect.sleep("650 millis");
        }),
      ),
    );

    expect(commands).toMatchObject([{ type: "thread.goal.continue" }]);
  });

  it("recovers only active root goals after restart", async () => {
    const commands: Array<{ readonly type: string; readonly trigger?: string }> = [];
    const continuation = await Effect.runPromise(
      makeProviderGoalContinuation({
        orchestrationEngine: {
          dispatch: (command) => Effect.sync(() => commands.push(command)),
          getReadModel: () =>
            Effect.succeed({
              threads: [
                activeThread(),
                activeThread({ id: ThreadId.makeUnsafe("thread-paused"), goalPausedAt: startedAt }),
                activeThread({
                  id: ThreadId.makeUnsafe("thread-child"),
                  parentThreadId: threadId,
                }),
                activeThread({
                  id: ThreadId.makeUnsafe("thread-plan"),
                  interactionMode: "plan",
                }),
              ],
            } as never),
        },
        turnQueue: new ProviderTurnQueue(),
        resolveThread: () => Effect.succeed(undefined),
        hasLiveProviderTurn: () => Effect.succeed(false),
        drainQueuedTurnsForThread: () => Effect.void,
        dispatchTurnForThread: () => Effect.succeed(turnId),
        setThreadSession: () => Effect.void,
        setThreadSessionError: () => Effect.void,
        interruptProviderTurn: () => Effect.void,
        serverCommandId: (tag) => CommandId.makeUnsafe(`server:${tag}`),
      }),
    );

    await Effect.runPromise(continuation.recoverActiveGoals);
    expect(commands).toMatchObject([
      { type: "thread.goal.continue", trigger: "startup-recovery" },
    ]);
  });
});
