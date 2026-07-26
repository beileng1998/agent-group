import { type TerminalAgentEvent, type ThreadId, WS_METHODS } from "@agent-group/contracts";
import { describe, expect, it, vi } from "vitest";

import { WsTerminalAgentSubscriptions } from "./wsTerminalAgentSubscriptions";
import type { WsSessionHandle } from "./wsTransportSession";

function session(label: string): WsSessionHandle {
  return {
    client: {
      [WS_METHODS.terminalAgentSubscribe]: vi.fn(() => `stream:${label}`),
    },
    runtime: {},
  } as unknown as WsSessionHandle;
}

function attachedEvent(): TerminalAgentEvent {
  return {
    type: "attached",
    threadId: "thread-terminal-stream" as ThreadId,
    revision: 3,
    generation: "generation-3",
    snapshot: {
      snapshotAnsi: "screen",
      scrollbackAnsi: "",
      rehydrateSequences: "",
      cols: 80,
      rows: 24,
      outputSequence: 10,
    },
  };
}

describe("WsTerminalAgentSubscriptions", () => {
  it("gives every view its own snapshot-first stream", async () => {
    const firstSession = session("first");
    const stopStream = vi.fn();
    const startStream = vi.fn();
    const subscriptions = new WsTerminalAgentSubscriptions({
      getSession: vi.fn().mockResolvedValue(firstSession),
      startStream,
      stopStream,
    });
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    const unsubscribeFirst = subscriptions.subscribe(
      { threadId: "thread-terminal-stream" as ThreadId },
      firstListener,
    );
    const unsubscribeSecond = subscriptions.subscribe(
      { threadId: "thread-terminal-stream" as ThreadId },
      secondListener,
    );
    await Promise.resolve();

    expect(startStream).toHaveBeenCalledTimes(2);
    const firstStreamListener = startStream.mock.calls[0]?.[3] as
      | ((event: TerminalAgentEvent) => void)
      | undefined;
    const secondStreamListener = startStream.mock.calls[1]?.[3] as
      | ((event: TerminalAgentEvent) => void)
      | undefined;
    firstStreamListener?.(attachedEvent());
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).not.toHaveBeenCalled();
    secondStreamListener?.(attachedEvent());
    expect(secondListener).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    expect(stopStream).toHaveBeenCalledWith("terminal.agent:thread-terminal-stream:1");
    unsubscribeSecond();
    expect(stopStream).toHaveBeenCalledWith("terminal.agent:thread-terminal-stream:2");
  });

  it("starts a fresh snapshot stream for a view mounted after output began", async () => {
    const startStream = vi.fn();
    const subscriptions = new WsTerminalAgentSubscriptions({
      getSession: vi.fn().mockResolvedValue(session("active")),
      startStream,
      stopStream: vi.fn(),
    });
    const firstListener = vi.fn();
    const lateListener = vi.fn();

    subscriptions.subscribe({ threadId: "thread-terminal-stream" as ThreadId }, firstListener);
    await Promise.resolve();
    const firstStreamListener = startStream.mock.calls[0]?.[3] as
      | ((event: TerminalAgentEvent) => void)
      | undefined;
    firstStreamListener?.(attachedEvent());
    firstStreamListener?.({
      type: "output",
      threadId: "thread-terminal-stream" as ThreadId,
      revision: 3,
      generation: "generation-3",
      seq: 11,
      data: "live",
    });

    subscriptions.subscribe({ threadId: "thread-terminal-stream" as ThreadId }, lateListener);
    await Promise.resolve();

    expect(startStream).toHaveBeenCalledTimes(2);
    expect(lateListener).not.toHaveBeenCalled();
    const lateStreamListener = startStream.mock.calls[1]?.[3] as
      | ((event: TerminalAgentEvent) => void)
      | undefined;
    lateStreamListener?.(attachedEvent());
    expect(lateListener).toHaveBeenCalledWith(attachedEvent());
  });

  it("restores one stream on reconnect without reacting recursively to its snapshot", async () => {
    const firstSession = session("first");
    const replacementSession = session("replacement");
    const startStream = vi.fn();
    const stopStream = vi.fn();
    const subscriptions = new WsTerminalAgentSubscriptions({
      getSession: vi.fn().mockResolvedValue(firstSession),
      startStream,
      stopStream,
    });
    const listener = vi.fn();

    subscriptions.subscribe({ threadId: "thread-terminal-stream" as ThreadId }, listener);
    await Promise.resolve();
    subscriptions.restore(replacementSession);

    expect(startStream).toHaveBeenCalledTimes(2);
    expect(stopStream).toHaveBeenCalledWith("terminal.agent:thread-terminal-stream:1");
    const staleListener = startStream.mock.calls[0]?.[3] as
      | ((event: TerminalAgentEvent) => void)
      | undefined;
    const replacementListener = startStream.mock.calls[1]?.[3] as
      | ((event: TerminalAgentEvent) => void)
      | undefined;
    staleListener?.(attachedEvent());
    expect(listener).not.toHaveBeenCalled();
    replacementListener?.(attachedEvent());
    expect(listener).toHaveBeenCalledOnce();
    expect(startStream).toHaveBeenCalledTimes(2);
  });

  it("does not let a delayed initial session replace a restored stream", async () => {
    let resolveInitialSession: ((session: WsSessionHandle) => void) | undefined;
    const initialSessionPromise = new Promise<WsSessionHandle>((resolve) => {
      resolveInitialSession = resolve;
    });
    const replacementSession = session("replacement");
    const startStream = vi.fn();
    const subscriptions = new WsTerminalAgentSubscriptions({
      getSession: () => initialSessionPromise,
      startStream,
      stopStream: vi.fn(),
    });

    subscriptions.subscribe({ threadId: "thread-terminal-stream" as ThreadId }, vi.fn());
    subscriptions.restore(replacementSession);
    resolveInitialSession?.(session("stale-initial"));
    await Promise.resolve();
    await Promise.resolve();

    expect(startStream).toHaveBeenCalledOnce();
    expect(startStream.mock.calls[0]?.[0]).toBe(replacementSession);
  });

  it("does not start a late stream after its only subscriber unmounts", async () => {
    let resolveSession: ((session: WsSessionHandle) => void) | undefined;
    const sessionPromise = new Promise<WsSessionHandle>((resolve) => {
      resolveSession = resolve;
    });
    const startStream = vi.fn();
    const subscriptions = new WsTerminalAgentSubscriptions({
      getSession: () => sessionPromise,
      startStream,
      stopStream: vi.fn(),
    });

    const unsubscribe = subscriptions.subscribe(
      { threadId: "thread-terminal-stream" as ThreadId },
      vi.fn(),
    );
    unsubscribe();
    resolveSession?.(session("late"));
    await Promise.resolve();
    await Promise.resolve();

    expect(startStream).not.toHaveBeenCalled();
  });

  it("tears down every active stream when the transport is disposed", async () => {
    const stopStream = vi.fn();
    const subscriptions = new WsTerminalAgentSubscriptions({
      getSession: vi.fn().mockResolvedValue(session("active")),
      startStream: vi.fn(),
      stopStream,
    });
    subscriptions.subscribe({ threadId: "thread-terminal-stream" as ThreadId }, vi.fn());
    await Promise.resolve();

    subscriptions.clear();

    expect(stopStream).toHaveBeenCalledWith("terminal.agent:thread-terminal-stream:1");
  });
});
