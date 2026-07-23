// FILE: remoteOrchestrationTransport.test.ts
// Purpose: Verifies the browser HTTP command path and weak-network event fallback.
// Layer: Web transport tests

import {
  CommandId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  type ClientOrchestrationCommand,
  type RemoteBootstrapSnapshot,
} from "@agent-group/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRemoteOrchestrationTransport } from "./remoteOrchestrationTransport";
import type { WsTransport } from "./wsTransport";
import type { WsTransportState } from "./wsTransportEvents";

const mocks = vi.hoisted(() => ({
  publishShell: vi.fn(),
  publishThread: vi.fn(),
  refreshBootstrap: vi.fn(),
  resolveThreadId: vi.fn(),
}));

vi.mock("./remoteBootstrapClient", () => ({
  refreshRemoteBootstrap: mocks.refreshBootstrap,
  resolveRemoteBootstrapThreadId: mocks.resolveThreadId,
}));

vi.mock("./ws-native/wsNativeEventRegistry", () => ({
  publishOrchestrationShellEvent: mocks.publishShell,
  publishOrchestrationThreadEvent: mocks.publishThread,
}));

function projectCreateCommand(): ClientOrchestrationCommand {
  return {
    type: "project.create",
    commandId: CommandId.makeUnsafe("command-http"),
    projectId: ProjectId.makeUnsafe("project-http"),
    kind: "project",
    title: "HTTP project",
    workspaceRoot: "/tmp/http-project",
    createdAt: "2026-07-23T00:00:00.000Z",
  };
}

function createWsTransport(initialState: WsTransportState) {
  let state = initialState;
  const listeners = new Set<(state: WsTransportState) => void>();
  const request = vi.fn<(...args: Array<unknown>) => Promise<unknown>>();
  const transport = {
    getState: () => state,
    onStateChange: (
      listener: (state: WsTransportState) => void,
      options?: { readonly replayCurrent?: boolean },
    ) => {
      listeners.add(listener);
      if (options?.replayCurrent) listener(state);
      return () => listeners.delete(listener);
    },
    request,
  } as unknown as WsTransport;
  return {
    request,
    setState(nextState: WsTransportState) {
      state = nextState;
      for (const listener of listeners) listener(nextState);
    },
    transport,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function eventBatch(input: {
  readonly nextSequence: number;
  readonly shellEvents?: ReadonlyArray<unknown>;
  readonly threadEvents?: ReadonlyArray<unknown>;
}) {
  return {
    version: 1,
    nextSequence: input.nextSequence,
    hasMore: false,
    shellEvents: input.shellEvents ?? [],
    threadEvents: input.threadEvents ?? [],
  };
}

beforeEach(() => {
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
  mocks.publishShell.mockReset();
  mocks.publishThread.mockReset();
  mocks.refreshBootstrap.mockReset();
  mocks.resolveThreadId.mockReset().mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("remote orchestration transport", () => {
  it("dispatches browser commands through the independent HTTP endpoint", async () => {
    const ws = createWsTransport("open");
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === "/api/remote-command"
          ? jsonResponse({ sequence: 7 })
          : jsonResponse(
              eventBatch({
                nextSequence: 7,
                shellEvents: [
                  {
                    kind: "thread-removed",
                    sequence: 7,
                    threadId: "thread-1",
                  },
                ],
              }),
            ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const remote = createRemoteOrchestrationTransport(ws.transport);
    const command = projectCreateCommand();

    await expect(remote.dispatchCommand(command)).resolves.toEqual({ sequence: 7 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/remote-command",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ command }),
      }),
    );
    expect(ws.request).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(mocks.publishShell).toHaveBeenCalledWith({
        kind: "thread-removed",
        sequence: 7,
        threadId: "thread-1",
      }),
    );
    remote.dispose();
  });

  it("does not replay rejected commands over WebSocket", async () => {
    const ws = createWsTransport("open");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "invalid" }, 400)));
    const remote = createRemoteOrchestrationTransport(ws.transport);

    await expect(remote.dispatchCommand(projectCreateCommand())).rejects.toThrow("invalid");

    expect(ws.request).not.toHaveBeenCalled();
    remote.dispose();
  });

  it("uses the open WebSocket only when the HTTP endpoint is unavailable", async () => {
    const ws = createWsTransport("open");
    ws.request.mockResolvedValue({ sequence: 9 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(null, 404)));
    const remote = createRemoteOrchestrationTransport(ws.transport);
    const command = projectCreateCommand();

    await expect(remote.dispatchCommand(command)).resolves.toEqual({ sequence: 9 });

    expect(ws.request).toHaveBeenCalledWith(ORCHESTRATION_WS_METHODS.dispatchCommand, { command });
    remote.dispose();
  });

  it("uses HTTP catch-up for active browser threads even while WebSocket reports open", async () => {
    const ws = createWsTransport("open");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(eventBatch({ nextSequence: 4 })));
    vi.stubGlobal("fetch", fetchMock);
    const remote = createRemoteOrchestrationTransport(ws.transport);

    await expect(remote.replayEvents(3)).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/remote-events?after=3",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(ws.request).not.toHaveBeenCalled();
    remote.dispose();
  });

  it("hydrates and polls cursor events while WebSocket is unavailable", async () => {
    const ws = createWsTransport("closed");
    mocks.resolveThreadId.mockReturnValue("thread-1");
    mocks.refreshBootstrap.mockResolvedValue({
      shell: { snapshotSequence: 5 },
      thread: {
        snapshotSequence: 3,
        thread: { id: "thread-1" },
      },
    } as unknown as RemoteBootstrapSnapshot);
    let eventRequestCount = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      eventRequestCount += 1;
      if (eventRequestCount === 1) {
        return Promise.resolve(
          jsonResponse(
            eventBatch({
              nextSequence: 6,
              shellEvents: [
                {
                  kind: "thread-removed",
                  sequence: 6,
                  threadId: "thread-1",
                },
              ],
              threadEvents: [],
            }),
          ),
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const remote = createRemoteOrchestrationTransport(ws.transport);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(mocks.refreshBootstrap).toHaveBeenCalledWith("thread-1");
    expect(mocks.publishShell).toHaveBeenNthCalledWith(1, {
      kind: "snapshot",
      snapshot: { snapshotSequence: 5 },
    });
    expect(mocks.publishThread).toHaveBeenCalledWith({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 3,
        thread: { id: "thread-1" },
      },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/remote-events?after=3&threadId=thread-1");
    expect(mocks.publishShell).toHaveBeenNthCalledWith(2, {
      kind: "thread-removed",
      sequence: 6,
      threadId: "thread-1",
    });

    ws.setState("open");
    remote.dispose();
  });
});
