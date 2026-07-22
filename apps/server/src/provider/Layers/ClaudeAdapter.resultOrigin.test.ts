import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ThreadId } from "@agent-group/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Random, Stream } from "effect";

import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { makeClaudeAdapterTestHarness } from "./ClaudeAdapter.testHarness.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread-claude-result-origin");

function makeDeterministicRandomService(seed = 0x1234_5678): {
  nextIntUnsafe: () => number;
  nextDoubleUnsafe: () => number;
} {
  let state = seed >>> 0;
  const nextIntUnsafe = (): number => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state;
  };
  return {
    nextIntUnsafe,
    nextDoubleUnsafe: () => nextIntUnsafe() / 0x1_0000_0000,
  };
}

describe("ClaudeAdapterLive result origin", () => {
  it.effect("does not settle an active Turn with a background task notification result", () => {
    const harness = makeClaudeAdapterTestHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "turn.completed" && event.payload.totalCostUsd === 1,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "Continue the learning plan",
        attachments: [],
      });

      harness.query.emit({
        type: "user",
        message: {
          role: "user",
          content: "<task-notification>Background task completed</task-notification>",
        },
        parent_tool_use_id: null,
        origin: { kind: "task-notification" },
        session_id: "sdk-resume-session",
        uuid: "stale-task-notification",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        origin: { kind: "task-notification" },
        total_cost_usd: 0,
        session_id: "sdk-resume-session",
        uuid: "stale-task-result",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "system",
        subtype: "status",
        status: null,
        session_id: "sdk-resume-session",
        uuid: "active-user-turn-status",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-resume-session",
        uuid: "user-turn-text",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Learning plan" },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        origin: { kind: "human" },
        total_cost_usd: 1,
        session_id: "sdk-resume-session",
        uuid: "user-turn-result",
      } as unknown as SDKMessage);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const turnCompleted = events.filter((event) => event.type === "turn.completed");
      assert.equal(turnCompleted.length, 1);
      assert.equal(String(turnCompleted[0]?.turnId), String(turn.turnId));

      const activeStatus = events.find(
        (event) =>
          event.type === "session.state.changed" && event.payload.reason === "status:active",
      );
      assert.equal(String(activeStatus?.turnId), String(turn.turnId));

      const assistantDelta = events.find(
        (event) => event.type === "content.delta" && event.payload.delta === "Learning plan",
      );
      assert.equal(String(assistantDelta?.turnId), String(turn.turnId));
      assert.equal(events.some((event) => event.type === "runtime.error"), false);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
