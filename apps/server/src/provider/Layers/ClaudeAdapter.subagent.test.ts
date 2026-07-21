import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ThreadId } from "@agent-group/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Random, Stream } from "effect";

import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { type FakeClaudeQuery, makeClaudeAdapterTestHarness } from "./ClaudeAdapter.testHarness.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread-claude-subagent");

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

function emitTaskTool(query: FakeClaudeQuery, toolUseId: string): void {
  query.emit({
    type: "stream_event",
    session_id: "sdk-subagent-session",
    uuid: `tool-${toolUseId}`,
    parent_tool_use_id: null,
    event: {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: toolUseId,
        name: "Task",
        input: {
          description: "Review architecture",
          prompt: "Inspect the provider boundary",
          subagent_type: "code-reviewer",
        },
      },
    },
  } as unknown as SDKMessage);
}

function emitTaskStarted(query: FakeClaudeQuery, toolUseId: string, taskId: string): void {
  query.emit({
    type: "system",
    subtype: "task_started",
    task_id: taskId,
    tool_use_id: toolUseId,
    description: "Review architecture",
    subagent_type: "code-reviewer",
    task_type: "local_agent",
    session_id: "sdk-subagent-session",
    uuid: `started-${taskId}`,
  } as unknown as SDKMessage);
}

function emitChildText(query: FakeClaudeQuery, toolUseId: string, text: string): void {
  query.emit({
    type: "stream_event",
    session_id: "sdk-subagent-session",
    uuid: `child-start-${toolUseId}`,
    parent_tool_use_id: toolUseId,
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
  } as unknown as SDKMessage);
  query.emit({
    type: "stream_event",
    session_id: "sdk-subagent-session",
    uuid: `child-delta-${toolUseId}`,
    parent_tool_use_id: toolUseId,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
  } as unknown as SDKMessage);
  query.emit({
    type: "stream_event",
    session_id: "sdk-subagent-session",
    uuid: `child-stop-${toolUseId}`,
    parent_tool_use_id: toolUseId,
    event: { type: "content_block_stop", index: 0 },
  } as unknown as SDKMessage);
  query.emit({
    type: "assistant",
    session_id: "sdk-subagent-session",
    uuid: `child-assistant-${toolUseId}`,
    parent_tool_use_id: toolUseId,
    message: {
      id: `child-message-${toolUseId}`,
      content: [{ type: "text", text }],
    },
  } as unknown as SDKMessage);
}

describe("ClaudeAdapterLive subagent routing", () => {
  it.effect("routes live child output and terminal state without replacing parent events", () => {
    const harness = makeClaudeAdapterTestHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const toolUseId = "task-tool-live";
      const taskId = "task-live";
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) =>
            event.type === "turn.completed" && event.providerRefs?.providerThreadId === toolUseId,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "delegate", attachments: [] });

      emitTaskTool(harness.query, toolUseId);
      emitTaskStarted(harness.query, toolUseId, taskId);
      emitChildText(harness.query, toolUseId, "Child review complete.");
      harness.query.emit({
        type: "system",
        subtype: "task_progress",
        task_id: taskId,
        tool_use_id: toolUseId,
        description: "Reviewing provider boundary",
        usage: { total_tokens: 42, tool_uses: 2, duration_ms: 250 },
        session_id: "sdk-subagent-session",
        uuid: "task-live-progress",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "system",
        subtype: "task_notification",
        task_id: taskId,
        tool_use_id: toolUseId,
        status: "completed",
        output_file: "",
        summary: "Review complete",
        session_id: "sdk-subagent-session",
        uuid: "task-live-completed",
      } as unknown as SDKMessage);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const childDelta = events.find(
        (event) =>
          event.type === "content.delta" && event.providerRefs?.providerThreadId === toolUseId,
      );
      assert.equal(childDelta?.type, "content.delta");
      if (childDelta?.type === "content.delta") {
        assert.equal(childDelta.payload.delta, "Child review complete.");
        assert.equal(childDelta.providerRefs?.providerParentThreadId, String(THREAD_ID));
      }

      const childCompleted = events.find(
        (event) =>
          event.type === "turn.completed" && event.providerRefs?.providerThreadId === toolUseId,
      );
      assert.equal(childCompleted?.type, "turn.completed");
      if (childCompleted?.type === "turn.completed") {
        assert.equal(childCompleted.payload.state, "completed");
      }
      assert.equal(
        events.some(
          (event) =>
            event.type === "thread.token-usage.updated" &&
            event.providerRefs?.providerThreadId === toolUseId,
        ),
        true,
      );
      assert.equal(
        events.some(
          (event) =>
            event.type === "task.completed" && event.providerRefs?.providerThreadId === undefined,
        ),
        true,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  for (const [status, turnState] of [
    ["completed", "completed"],
    ["failed", "failed"],
    ["stopped", "interrupted"],
  ] as const) {
    it.effect(`settles a ${status} child that produced no text`, () => {
      const harness = makeClaudeAdapterTestHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const toolUseId = `task-tool-no-text-${status}`;
        const taskId = `task-no-text-${status}`;
        const eventsFiber = yield* adapter.streamEvents.pipe(
          Stream.takeUntil(
            (event) =>
              event.type === "turn.completed" && event.providerRefs?.providerThreadId === toolUseId,
          ),
          Stream.runCollect,
          Effect.forkChild,
        );
        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "delegate",
          attachments: [],
        });
        emitTaskTool(harness.query, toolUseId);
        emitTaskStarted(harness.query, toolUseId, taskId);
        harness.query.emit({
          type: "system",
          subtype: "task_notification",
          task_id: taskId,
          tool_use_id: toolUseId,
          status,
          output_file: "",
          summary: status,
          session_id: "sdk-subagent-session",
          uuid: `task-no-text-terminal-${status}`,
        } as unknown as SDKMessage);

        const events = Array.from(yield* Fiber.join(eventsFiber));
        assert.equal(
          events.some(
            (event) =>
              event.type === "turn.started" && event.providerRefs?.providerThreadId === toolUseId,
          ),
          true,
        );
        const completed = events.find(
          (event) =>
            event.type === "turn.completed" && event.providerRefs?.providerThreadId === toolUseId,
        );
        assert.equal(completed?.type, "turn.completed");
        if (completed?.type === "turn.completed") {
          assert.equal(completed.payload.state, turnState);
        }
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    });
  }

  it.effect("stops only the addressed child, including before the SDK task id exists", () => {
    const harness = makeClaudeAdapterTestHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const toolUseId = "task-tool-stop";
      const taskId = "task-stop";
      const toolStartedFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "item.started" && String(event.itemId) === toolUseId,
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
        input: "delegate",
        attachments: [],
      });
      emitTaskTool(harness.query, toolUseId);
      yield* Fiber.join(toolStartedFiber);

      yield* adapter.interruptTurn(session.threadId, turn.turnId, toolUseId);
      assert.deepEqual(harness.query.stopTaskCalls, []);
      assert.equal(harness.query.interruptCalls.length, 0);

      const taskStartedFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "task.started" && String(event.payload.taskId) === taskId,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      emitTaskStarted(harness.query, toolUseId, taskId);
      yield* Fiber.join(taskStartedFiber);
      assert.deepEqual(harness.query.stopTaskCalls, [taskId]);
      assert.equal(harness.query.interruptCalls.length, 0);

      yield* adapter.interruptTurn(session.threadId, turn.turnId, toolUseId);
      assert.deepEqual(harness.query.stopTaskCalls, [taskId, taskId]);

      const taskCompletedFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "task.completed" && String(event.payload.taskId) === taskId,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      harness.query.emit({
        type: "system",
        subtype: "task_notification",
        task_id: taskId,
        tool_use_id: toolUseId,
        status: "stopped",
        output_file: "",
        summary: "Stopped",
        session_id: "sdk-subagent-session",
        uuid: "task-stop-completed",
      } as unknown as SDKMessage);
      yield* Fiber.join(taskCompletedFiber);

      const toolResultFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "item.completed" && String(event.itemId) === toolUseId,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      harness.query.emit({
        type: "user",
        session_id: "sdk-subagent-session",
        uuid: "task-stop-result",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              is_error: true,
              content: "Task stopped",
            },
          ],
        },
      } as unknown as SDKMessage);
      const toolResultEvents = Array.from(yield* Fiber.join(toolResultFiber));
      const toolCompleted = toolResultEvents.find(
        (event) => event.type === "item.completed" && String(event.itemId) === toolUseId,
      );
      assert.equal(toolCompleted?.type, "item.completed");
      if (toolCompleted?.type === "item.completed") {
        assert.deepEqual((toolCompleted.payload.data as Record<string, unknown>).agentStates, {
          [toolUseId]: { status: "stopped" },
        });
      }

      yield* adapter.interruptTurn(session.threadId, turn.turnId, toolUseId);
      assert.deepEqual(harness.query.stopTaskCalls, [taskId, taskId]);
      assert.equal(harness.query.interruptCalls.length, 0);
      yield* adapter.interruptTurn(session.threadId, turn.turnId);
      assert.equal(harness.query.interruptCalls.length, 1);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("settles from task_updated and drops late child traffic", () => {
    const harness = makeClaudeAdapterTestHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const toolUseId = "task-tool-zombie";
      const taskId = "task-zombie";
      const terminalFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) =>
            event.type === "turn.completed" && event.providerRefs?.providerThreadId === toolUseId,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "delegate", attachments: [] });
      emitTaskTool(harness.query, toolUseId);
      emitTaskStarted(harness.query, toolUseId, taskId);
      emitChildText(harness.query, toolUseId, "Partial child result.");
      harness.query.emit({
        type: "system",
        subtype: "task_updated",
        task_id: taskId,
        patch: { status: "killed" },
        session_id: "sdk-subagent-session",
        uuid: "task-zombie-killed",
      } as unknown as SDKMessage);

      const terminalEvents = Array.from(yield* Fiber.join(terminalFiber));
      const childCompleted = terminalEvents.find(
        (event) =>
          event.type === "turn.completed" && event.providerRefs?.providerThreadId === toolUseId,
      );
      assert.equal(childCompleted?.type, "turn.completed");
      if (childCompleted?.type === "turn.completed") {
        assert.equal(childCompleted.payload.state, "interrupted");
      }

      const finalEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "task.completed" && String(event.payload.taskId) === taskId,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      emitChildText(harness.query, toolUseId, "Late zombie output.");
      harness.query.emit({
        type: "system",
        subtype: "task_notification",
        task_id: taskId,
        tool_use_id: toolUseId,
        status: "stopped",
        output_file: "",
        summary: "Stopped",
        usage: { total_tokens: 84, tool_uses: 3, duration_ms: 500 },
        session_id: "sdk-subagent-session",
        uuid: "task-zombie-notification",
      } as unknown as SDKMessage);

      const finalEvents = Array.from(yield* Fiber.join(finalEventsFiber));
      assert.equal(
        finalEvents.some(
          (event) =>
            event.type === "thread.token-usage.updated" &&
            event.providerRefs?.providerThreadId === toolUseId,
        ),
        true,
      );
      assert.equal(
        finalEvents.some(
          (event) =>
            (event.type === "content.delta" || event.type === "turn.started") &&
            event.providerRefs?.providerThreadId === toolUseId,
        ),
        false,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
