import { describe, expect, it } from "vitest";

import type { ExecutionAdapterState } from "../orchestration/Services/ExecutionAdapterCoordinator";
import {
  handshakeRuntimeEventsHarness as handshake,
  makeRuntimeEventsHarness as makeHarness,
} from "./terminalAgentRuntimeEvents.testSupport";

describe("managed terminal runtime event failures", () => {
  it("fails closed before prompt acceptance when the feature is disabled", async () => {
    const harness = makeHarness();
    await handshake(harness);
    const prompt = {
      event_name: "prompt_submit",
      event_id: "prompt-disabled",
      session_id: "provider-session-1",
      prompt: "Do not reach the model.",
    };

    harness.setManagedTerminalEnabled(false);
    await expect(harness.invoke(prompt)).rejects.toThrow("disabled in server settings");
    expect(harness.runtime.activeTurn).toBeNull();
    expect(harness.commands).toHaveLength(0);

    harness.setManagedTerminalEnabled(true);
    await harness.invoke(prompt);
    harness.setManagedTerminalEnabled(false);
    await expect(
      harness.invoke({ prompt: "Do not reach the model." }, "prompt-disabled", "prompt-accepted"),
    ).rejects.toThrow("disabled in server settings");
    expect(harness.runtime.activeTurn).toMatchObject({ accepted: false });
    expect(harness.commands).toHaveLength(0);
    expect(harness.events.filter((event) => event.type === "turn.started")).toHaveLength(0);
  });

  it("still accepts lifecycle cleanup after the feature is disabled", async () => {
    const harness = makeHarness();
    await handshake(harness);
    await harness.invoke({
      event_name: "prompt_submit",
      event_id: "prompt-before-disable",
      session_id: "provider-session-1",
      prompt: "Finish safely.",
    });
    await harness.invoke({ prompt: "Finish safely." }, "prompt-before-disable", "prompt-accepted");

    harness.setManagedTerminalEnabled(false);
    await harness.invoke({
      event_name: "turn_stop",
      event_id: "stop-after-disable",
      session_id: "provider-session-1",
      assistant_text: "Finished.",
    });
    expect(harness.runtime.activeTurn).toBeNull();
    expect(harness.getState()).toMatchObject({
      status: "ready",
      activeTurnId: null,
    });
  });

  it("rejects hook work after the authority runtime fence changes", async () => {
    const harness = makeHarness();
    await handshake(harness);
    harness.setState({
      ...harness.getState(),
      adapter: "terminal",
      runtimeInstanceId: "runtime-2",
    } as ExecutionAdapterState);
    await expect(
      harness.invoke({
        event_name: "prompt_submit",
        event_id: "stale-prompt",
        prompt: "Do not run.",
      }),
    ).rejects.toThrow(/stale/);
    expect(harness.commands).toHaveLength(0);
  });

  it("rolls admission back for a retry when turn-start projection fails", async () => {
    const harness = makeHarness();
    await handshake(harness);
    const prompt = {
      event_name: "prompt_submit",
      event_id: "prompt-retry",
      session_id: "provider-session-1",
      prompt: "Retry this exact prompt.",
    };
    const prepared = await harness.invoke(prompt);
    harness.failNextPublish();

    await expect(
      harness.invoke({ prompt: "Retry this exact prompt." }, "prompt-retry", "prompt-accepted"),
    ).rejects.toThrow("projection unavailable");
    expect(harness.getState()).toMatchObject({
      status: "attention",
      activeTurnId: null,
    });
    expect(harness.runtime.activeTurn).toMatchObject({
      accepted: false,
      prompt: "Retry this exact prompt.",
    });
    await expect(harness.invoke(prompt)).resolves.toEqual(prepared);

    await harness.invoke({ prompt: "Retry this exact prompt." }, "prompt-retry", "prompt-accepted");
    expect(harness.getState()).toMatchObject({
      status: "running",
      activeTurnId: harness.runtime.activeTurn?.turnId,
    });
    expect(harness.commands).toHaveLength(2);
    expect(harness.commands[0]?.commandId).toBe(harness.commands[1]?.commandId);
    expect(harness.events.filter((event) => event.type === "turn.started")).toHaveLength(1);
  });

  it("does not strand authority when visible prompt projection fails", async () => {
    const harness = makeHarness();
    await handshake(harness);
    const prompt = {
      event_name: "prompt_submit",
      event_id: "prompt-command-retry",
      session_id: "provider-session-1",
      prompt: "Project me once.",
    };
    await harness.invoke(prompt);
    harness.failNextDispatch();

    await expect(
      harness.invoke({ prompt: "Project me once." }, "prompt-command-retry", "prompt-accepted"),
    ).rejects.toThrow("command unavailable");
    expect(harness.getState()).toMatchObject({
      status: "attention",
      activeTurnId: null,
    });

    await harness.invoke({ prompt: "Project me once." }, "prompt-command-retry", "prompt-accepted");
    expect(harness.commands).toHaveLength(1);
    expect(harness.events.filter((event) => event.type === "turn.started")).toHaveLength(1);
    expect(harness.getState()).toMatchObject({ status: "running" });
  });
});
