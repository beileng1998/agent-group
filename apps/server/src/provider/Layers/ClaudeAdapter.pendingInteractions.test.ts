import type { PermissionResult, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ApprovalRequestId, ThreadId } from "@agent-group/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Random, Stream } from "effect";

import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { makeClaudeAdapterTestHarness } from "./ClaudeAdapter.testHarness.ts";

const threadId = ThreadId.makeUnsafe("thread-claude-pending-interactions");

function randomService(seed = 0x1234_5678) {
  let state = seed >>> 0;
  const nextIntUnsafe = () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state;
  };
  return { nextIntUnsafe, nextDoubleUnsafe: () => nextIntUnsafe() / 0x1_0000_0000 };
}

const askInput = {
  questions: [
    {
      question: "Continue?",
      header: "Continue",
      options: [{ label: "Yes", description: "Proceed" }],
      multiSelect: false,
    },
  ],
};

function resultMessage(id: string): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    errors: [],
    session_id: `session-${id}`,
    uuid: `result-${id}`,
  } as unknown as SDKMessage;
}

describe("Claude pending interaction ownership", () => {
  it.effect("settles a foreground question before its Turn completes", () => {
    const harness = makeClaudeAdapterTestHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);
      yield* adapter.sendTurn({ threadId, input: "ask", attachments: [] });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);

      const canUseTool = harness.getLastCreateQueryInput()?.options.canUseTool;
      if (!canUseTool) return assert.fail("Expected canUseTool");
      const permissionPromise = canUseTool("AskUserQuestion", askInput, {
        signal: new AbortController().signal,
        toolUseID: "tool-foreground-question",
        requestId: "request-foreground-question",
      });
      const requested = yield* Stream.runHead(adapter.streamEvents);
      if (requested._tag !== "Some" || requested.value.type !== "user-input.requested") {
        return assert.fail("Expected user-input.requested");
      }

      const lifecycleFiber = yield* adapter.streamEvents.pipe(
        Stream.filter(
          (event) => event.type === "user-input.resolved" || event.type === "turn.completed",
        ),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      harness.query.emit(resultMessage("foreground-question"));
      const lifecycle = Array.from(yield* Fiber.join(lifecycleFiber));

      assert.deepEqual(
        lifecycle.map((event) => event.type),
        ["user-input.resolved", "turn.completed"],
      );
      assert.deepEqual(yield* Effect.promise(() => permissionPromise), {
        behavior: "deny",
        message: "User cancelled tool execution.",
      } satisfies PermissionResult);
      const lateResponse = yield* Effect.exit(
        adapter.respondToUserInput(
          session.threadId,
          ApprovalRequestId.makeUnsafe(requested.value.requestId!),
          { Continue: "Yes" },
        ),
      );
      assert.equal(Exit.isFailure(lateResponse), true);
    }).pipe(Effect.provideService(Random.Random, randomService()), Effect.provide(harness.layer));
  });

  it.effect("keeps an agent-scoped question open when the foreground Turn completes", () => {
    const harness = makeClaudeAdapterTestHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);
      yield* adapter.sendTurn({ threadId, input: "delegate", attachments: [] });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);

      const canUseTool = harness.getLastCreateQueryInput()?.options.canUseTool;
      if (!canUseTool) return assert.fail("Expected canUseTool");
      const permissionPromise = canUseTool("AskUserQuestion", askInput, {
        signal: new AbortController().signal,
        toolUseID: "tool-agent-question",
        agentID: "background-agent-1",
        requestId: "request-agent-question",
      });
      const requested = yield* Stream.runHead(adapter.streamEvents);
      if (requested._tag !== "Some" || requested.value.type !== "user-input.requested") {
        return assert.fail("Expected user-input.requested");
      }

      const completedFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.runHead,
        Effect.forkChild,
      );
      harness.query.emit(resultMessage("background-question"));
      yield* Fiber.join(completedFiber);

      yield* adapter.respondToUserInput(
        session.threadId,
        ApprovalRequestId.makeUnsafe(requested.value.requestId!),
        { Continue: "Yes" },
      );
      const resolved = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "user-input.resolved"),
        Stream.runHead,
      );
      assert.equal(resolved._tag === "Some" && resolved.value.type, "user-input.resolved");
      assert.equal((yield* Effect.promise(() => permissionPromise)).behavior, "allow");
    }).pipe(Effect.provideService(Random.Random, randomService()), Effect.provide(harness.layer));
  });

  it.effect("cancels an agent-scoped question when that agent terminates", () => {
    const harness = makeClaudeAdapterTestHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({ threadId, provider: "claudeAgent", runtimeMode: "full-access" });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);
      const canUseTool = harness.getLastCreateQueryInput()?.options.canUseTool;
      if (!canUseTool) return assert.fail("Expected canUseTool");
      const permissionPromise = canUseTool("AskUserQuestion", askInput, {
        signal: new AbortController().signal,
        agentID: "background-agent-2",
        requestId: "request-terminal-agent-question",
      });
      yield* Stream.runHead(adapter.streamEvents);

      harness.query.emit({
        type: "system",
        subtype: "task_updated",
        task_id: "background-agent-2",
        patch: { status: "completed" },
        session_id: "session-terminal-agent",
        uuid: "terminal-agent",
      } as unknown as SDKMessage);
      const resolved = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "user-input.resolved"),
        Stream.runHead,
      );

      assert.equal(resolved._tag === "Some" && resolved.value.type, "user-input.resolved");
      assert.equal((yield* Effect.promise(() => permissionPromise)).behavior, "deny");
    }).pipe(Effect.provideService(Random.Random, randomService()), Effect.provide(harness.layer));
  });
});
