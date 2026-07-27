import { describe, expect, it } from "vitest";

import {
  handshakeRuntimeEventsHarness as handshake,
  makeRuntimeEventsHarness as makeHarness,
} from "./terminalAgentRuntimeEvents.testSupport";

describe("managed terminal runtime events", () => {
  it("adopts provider-native resume cursors before making a session ready", async () => {
    const pi = makeHarness("pi");
    await handshake(pi);
    expect(pi.adoptedCursors).toEqual(["/sessions/provider-session-1.jsonl"]);
    expect(pi.getState()).toMatchObject({ status: "ready" });

    const claude = makeHarness("claudeAgent");
    await handshake(claude);
    expect(claude.adoptedCursors).toEqual([{ resume: "provider-session-1" }]);
  });

  it("blocks the terminal when cursor adoption fails", async () => {
    const harness = makeHarness();
    harness.failNextAdoption();
    await expect(handshake(harness)).rejects.toThrow("cursor persistence unavailable");
    expect(harness.runtime.handshakeReceived).toBe(false);
    expect(harness.getState()).toMatchObject({
      status: "context-blocked",
      error: "Agent Terminal session handshake failed. Retry or restart the terminal.",
    });
    expect(harness.events).toEqual([]);
  });

  it("force-releases a claim when a dependency ignores cancellation", async () => {
    const harness = makeHarness();
    harness.hangNextAdoption();
    const controller = new AbortController();
    const operation = harness.handler(
      {
        runtimeInstanceId: "runtime-1",
        eventId: "hung-session-start",
        input: {
          event_name: "session_start",
          event_id: "hung-session-start",
          session_id: "provider-session-1",
          session_file: "/sessions/provider-session-1.jsonl",
          reason: "startup",
        },
      },
      controller.signal,
    );
    while (!harness.adoptionStarted()) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    if ("then" in operation) void operation.catch(() => undefined);
    controller.abort();
    if ("cancel" in operation) await operation.cancel?.();

    expect(harness.releasedClaims()).toBe(1);
    harness.resolveHungAdoption();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.runtime.handshakeReceived).toBe(false);
    expect(harness.events).toEqual([]);
  });

  it("projects only raw visible text after the prompt acceptance handshake", async () => {
    const harness = makeHarness();
    await handshake(harness);
    expect(harness.runtime.handshakeReceived).toBe(true);
    expect(harness.runtime.capabilities.hookSchema).toBe("handshake-verified");

    const prepared = await harness.invoke({
      event_name: "prompt_submit",
      event_id: "prompt-1",
      session_id: "provider-session-1",
      prompt: "Keep this user text exact.",
    });
    expect(prepared.additionalContext).toBe(
      "Agent Group manages this Turn. Follow the user request.",
    );
    expect(harness.commands).toHaveLength(0);
    expect(harness.firstTurnTitles).toHaveLength(0);
    expect(harness.runtime.activeTurn?.accepted).toBe(false);

    await expect(
      harness.invoke({ prompt: "wrong" }, "prompt-1", "prompt-accepted"),
    ).rejects.toThrow(/does not match/);
    await harness.invoke({ prompt: "Keep this user text exact." }, "prompt-1", "prompt-accepted");
    await harness.invoke({ prompt: "Keep this user text exact." }, "prompt-1", "prompt-accepted");

    expect(harness.commands).toHaveLength(1);
    expect(harness.commands[0]).toMatchObject({
      type: "thread.terminal-message.observe",
      role: "user",
      text: "Keep this user text exact.",
      terminalRuntimeFence: { revision: 3, generation: "generation-1" },
    });
    expect(harness.firstTurnTitles).toEqual([
      {
        threadId: harness.runtime.threadId,
        messageId: "terminal:runtime-1:prompt-1:user:message",
        messageText: "Keep this user text exact.",
      },
    ]);
    expect(harness.events.map((event) => event.type)).toEqual(["session.started", "turn.started"]);
    expect(harness.getState()).toMatchObject({
      status: "running",
      activeTurnId: harness.runtime.activeTurn?.turnId,
    });

    await harness.invoke({
      event_name: "turn_stop",
      event_id: "stop-1",
      session_id: "provider-session-1",
      assistant_text: "Exact assistant answer.",
    });
    expect(harness.commands[1]).toMatchObject({
      type: "thread.terminal-message.observe",
      role: "assistant",
      text: "Exact assistant answer.",
    });
    expect(harness.events.at(-1)?.type).toBe("turn.completed");
    expect(harness.runtime.activeTurn).toBeNull();
    expect(harness.getState()).toMatchObject({
      status: "ready",
      activeTurnId: null,
    });
  });

  it("deduplicates replayed hooks and retains a turn while background work remains", async () => {
    const harness = makeHarness("claudeAgent");
    await handshake(harness);
    const input = {
      hook_event_name: "UserPromptSubmit",
      session_id: "provider-session-1",
      prompt: "Run it.",
    };
    const first = await harness.invoke(input, "prompt-replay");
    const replay = await harness.invoke(input, "prompt-replay");
    expect(replay).toEqual(first);
    await harness.invoke({ prompt: "Run it." }, "prompt-replay", "prompt-accepted");
    await harness.invoke(
      {
        hook_event_name: "Stop",
        session_id: "provider-session-1",
        background_tasks: [{ id: "task-1" }],
      },
      "stop-background",
    );
    expect(harness.runtime.activeTurn).not.toBeNull();
    expect(harness.events.filter((event) => event.type === "turn.completed")).toHaveLength(0);
  });

  it("projects streaming input as a steer inside the active Agent Turn", async () => {
    const harness = makeHarness();
    await handshake(harness);
    const first = await harness.invoke(
      {
        event_name: "prompt_submit",
        event_id: "prompt-initial",
        session_id: "provider-session-1",
        prompt: "Start the task.",
      },
      "prompt-initial",
    );
    await harness.invoke({ prompt: "Start the task." }, "prompt-initial", "prompt-accepted");

    const steer = await harness.invoke(
      {
        event_name: "prompt_submit",
        event_id: "prompt-steer",
        session_id: "provider-session-1",
        prompt: "Focus on the failing test.",
        streaming_behavior: "steer",
      },
      "prompt-steer",
    );
    expect(steer.turnId).toBe(first.turnId);
    expect(harness.runtime.activeTurn?.pendingPrompt).toMatchObject({
      promptEventId: "prompt-steer",
      prompt: "Focus on the failing test.",
    });

    await harness.invoke(
      { prompt: "Focus on the failing test." },
      "prompt-steer",
      "prompt-accepted",
    );
    await harness.invoke(
      { prompt: "Focus on the failing test." },
      "prompt-steer",
      "prompt-accepted",
    );

    expect(
      harness.commands.filter((command) => command.type === "thread.terminal-message.observe"),
    ).toMatchObject([
      {
        role: "user",
        text: "Start the task.",
        turnId: first.turnId,
      },
      {
        role: "user",
        text: "Focus on the failing test.",
        turnId: first.turnId,
      },
    ]);
    expect(harness.events.filter((event) => event.type === "turn.started")).toHaveLength(1);
    expect(harness.runtime.activeTurn).toMatchObject({
      turnId: first.turnId,
      pendingPrompt: null,
      deliveredContext: "Agent Group manages this Turn. Follow the user request.",
    });
    expect(harness.getState()).toMatchObject({
      status: "running",
      activeTurnId: first.turnId,
    });
  });
});
