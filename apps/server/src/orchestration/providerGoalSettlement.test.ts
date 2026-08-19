import { EventId, ThreadId, TurnId, type OrchestrationThread } from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { GOAL_ACHIEVED_MARKER } from "../provider/providerGoalMode";
import { settleThreadGoalAfterTerminal } from "./providerGoalSettlement";

const threadId = ThreadId.makeUnsafe("thread-goal-settlement");
const turnId = TurnId.makeUnsafe("turn-goal-settlement");

function thread(text: string, patch: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: threadId,
    goal: "Finish everything",
    goalStartedAt: "2026-08-15T00:00:00.000Z",
    goalPausedAt: null,
    parentThreadId: null,
    archivedAt: null,
    deletedAt: null,
    messages: [
      {
        id: "assistant-goal" as never,
        role: "assistant",
        text,
        turnId,
        streaming: false,
        createdAt: "2026-08-15T00:00:01.000Z",
        updatedAt: "2026-08-15T00:00:01.000Z",
      },
    ],
    ...patch,
  } as unknown as OrchestrationThread;
}

function completedEvent(state = "completed") {
  return {
    type: "turn.completed",
    eventId: EventId.makeUnsafe(`event-goal-${state}`),
    provider: "codex",
    threadId,
    turnId,
    createdAt: "2026-08-15T00:00:02.000Z",
    payload: { state },
  } as never;
}

describe("provider goal settlement", () => {
  it("continues ordinary turns and records an explicit achieved marker", async () => {
    const commands: unknown[] = [];
    let current = thread("More work remains");
    const engine = {
      getReadModel: () => Effect.succeed({ threads: [current] } as never),
      dispatch: (command: unknown) => Effect.sync(() => commands.push(command)),
    };

    await Effect.runPromise(
      settleThreadGoalAfterTerminal({
        orchestrationEngine: engine as never,
        event: completedEvent(),
        threadId,
        turnId,
      }),
    );
    expect(commands[0]).toMatchObject({ type: "thread.goal.continue", threadId });

    commands.length = 0;
    current = thread(`Verified complete.\n${GOAL_ACHIEVED_MARKER}`);
    await Effect.runPromise(
      settleThreadGoalAfterTerminal({
        orchestrationEngine: engine as never,
        event: completedEvent(),
        threadId,
        turnId,
      }),
    );
    expect(commands[0]).toMatchObject({
      type: "thread.meta.update",
      threadId,
      goalAchieved: true,
    });
  });

  it("pauses instead of retrying a failed turn", async () => {
    const commands: unknown[] = [];
    await Effect.runPromise(
      settleThreadGoalAfterTerminal({
        orchestrationEngine: {
          getReadModel: () => Effect.succeed({ threads: [thread("Failed")] } as never),
          dispatch: (command: unknown) => Effect.sync(() => commands.push(command)),
        } as never,
        event: completedEvent("failed"),
        threadId,
        turnId,
      }),
    );
    expect(commands[0]).toMatchObject({ type: "thread.meta.update", goalPaused: true });
  });

  it("does not settle a new goal from an older turn marker", async () => {
    const commands: unknown[] = [];
    const current = thread(`Old completion.\n${GOAL_ACHIEVED_MARKER}`, {
      goalStartedAt: "2026-08-15T00:00:02.000Z",
    });
    await Effect.runPromise(
      settleThreadGoalAfterTerminal({
        orchestrationEngine: {
          getReadModel: () => Effect.succeed({ threads: [current] } as never),
          dispatch: (command: unknown) => Effect.sync(() => commands.push(command)),
        } as never,
        event: completedEvent(),
        threadId,
      }),
    );

    expect(commands[0]).toMatchObject({ type: "thread.goal.continue" });
  });
});
