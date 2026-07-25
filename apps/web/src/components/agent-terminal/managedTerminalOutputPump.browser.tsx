import "@xterm/xterm/css/xterm.css";

import {
  TERMINAL_AGENT_SNAPSHOT_MAX_BYTES,
  type NativeApi,
  type TerminalAgentEvent,
  type TerminalAgentRuntimeState,
  type TerminalAgentSubscribeInput,
  type ThreadId,
} from "@agent-group/contracts";
import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ManagedAgentTerminalProvider } from "./ManagedAgentTerminalContext";
import { ManagedAgentTerminalSurface } from "./ManagedAgentTerminalSurface";
import { ManagedTerminalInputQueue } from "./managedTerminalInputQueue";
import { ManagedTerminalOutputPump } from "./managedTerminalOutputPump";

const originalNativeApi = window.nativeApi;

function readBuffer(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

function parsedWrite(
  enqueue: (onParsed: () => void) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!enqueue(resolve)) reject(new Error("xterm write was rejected"));
  });
}

describe("managed terminal output pump in Chromium", () => {
  afterEach(() => {
    window.nativeApi = originalNativeApi;
    document.body.innerHTML = "";
  });

  it("renders snapshot-first output and replaces stale epochs on reconnect", async () => {
    const host = document.createElement("div");
    host.style.width = "800px";
    host.style.height = "420px";
    document.body.append(host);

    const terminal = new Terminal({
      cols: 100,
      rows: 24,
      scrollback: 500,
    });
    terminal.open(host);
    const overflows: Error[] = [];
    const pump = new ManagedTerminalOutputPump(terminal, () => {
      overflows.push(new Error("unexpected terminal output overflow"));
    });
    const parsed: string[] = [];

    try {
      pump.enqueue("stale-before-attach\r\n", () => parsed.push("stale"));
      const firstSnapshot = parsedWrite((done) =>
        pump.reset("\u001bcattach-snapshot\r\n", () => {
          parsed.push("snapshot-1");
          done();
        }),
      );
      const firstLive = parsedWrite((done) =>
        pump.enqueue("live-one\r\n\u001b[31mcolored\u001b[0m\r\n", () => {
          parsed.push("live-1");
          done();
        }),
      );
      await Promise.all([firstSnapshot, firstLive]);

      expect(readBuffer(terminal)).toContain("attach-snapshot");
      expect(readBuffer(terminal)).toContain("live-one");
      expect(readBuffer(terminal)).toContain("colored");
      expect(readBuffer(terminal)).not.toContain("stale-before-attach");
      expect(parsed).toEqual(["snapshot-1", "live-1"]);

      const resumedSnapshot = parsedWrite((done) =>
        pump.reset("\u001bcresumed-snapshot\r\n", () => {
          parsed.push("snapshot-2");
          done();
        }),
      );
      const resumedLive = parsedWrite((done) =>
        pump.enqueue("live-after-reconnect\r\n", () => {
          parsed.push("live-2");
          done();
        }),
      );
      await Promise.all([resumedSnapshot, resumedLive]);

      const resumedBuffer = readBuffer(terminal);
      expect(resumedBuffer).toContain("resumed-snapshot");
      expect(resumedBuffer).toContain("live-after-reconnect");
      expect(resumedBuffer).not.toContain("attach-snapshot");
      expect(resumedBuffer).not.toContain("live-one");
      expect(parsed).toEqual([
        "snapshot-1",
        "live-1",
        "snapshot-2",
        "live-2",
      ]);
      expect(overflows).toEqual([]);
    } finally {
      pump.dispose();
      terminal.dispose();
    }
  });

  it("does not hot-resubscribe an oversized snapshot for the same epoch", async () => {
    const threadId = "oversized-terminal-snapshot" as ThreadId;
    let listener: ((event: TerminalAgentEvent) => void) | undefined;
    const subscribe = vi.fn(
      (
        _input: TerminalAgentSubscribeInput,
        nextListener: (event: TerminalAgentEvent) => void,
      ) => {
        listener = nextListener;
        return () => {};
      },
    );
    window.nativeApi = {
      terminalAgent: {
        subscribe,
        resize: vi.fn(async () => {}),
        write: vi.fn(async () => {}),
      },
    } as unknown as NativeApi;
    const state: TerminalAgentRuntimeState = {
      threadId,
      authority: "terminal",
      revision: 1,
      provider: "codex",
      status: "ready",
      runtimeInstanceId: "runtime-1",
      generation: "generation-1",
      pid: 123,
      providerSessionId: "provider-session-1",
      model: null,
      effort: null,
      permission: null,
      capabilities: null,
      exit: null,
      error: null,
    };
    const mounted = await render(
      <ManagedAgentTerminalProvider
        value={{
          threadId,
          state,
          active: true,
          available: true,
          busy: false,
          featureEnabled: true,
          start: async () => {},
          switchToChat: async () => {},
          restart: async () => {},
          stop: async () => {},
          setViewportSize: () => {},
        }}
      >
        <ManagedAgentTerminalSurface />
      </ManagedAgentTerminalProvider>,
    );
    try {
      await expect.poll(() => subscribe.mock.calls.length).toBe(1);
      const oversized: TerminalAgentEvent = {
        type: "attached",
        threadId,
        revision: 1,
        generation: "generation-1",
        snapshot: {
          snapshotAnsi: "x".repeat(TERMINAL_AGENT_SNAPSHOT_MAX_BYTES + 1),
          scrollbackAnsi: "",
          rehydrateSequences: "",
          cols: 80,
          rows: 24,
          outputSequence: 0,
        },
      };
      listener?.(oversized);
      listener?.(oversized);
      await new Promise((resolve) => window.setTimeout(resolve, 20));

      expect(subscribe).toHaveBeenCalledOnce();
    } finally {
      await mounted.unmount();
    }
  });

  it("resubscribes once when xterm synchronously rejects an attached snapshot", async () => {
    const threadId = "failed-terminal-snapshot-write" as ThreadId;
    let listener: ((event: TerminalAgentEvent) => void) | undefined;
    const subscribe = vi.fn(
      (
        _input: TerminalAgentSubscribeInput,
        nextListener: (event: TerminalAgentEvent) => void,
      ) => {
        listener = nextListener;
        return () => {};
      },
    );
    window.nativeApi = {
      terminalAgent: {
        subscribe,
        resize: vi.fn(async () => {}),
        write: vi.fn(async () => {}),
      },
    } as unknown as NativeApi;
    const state: TerminalAgentRuntimeState = {
      threadId,
      authority: "terminal",
      revision: 1,
      provider: "codex",
      status: "ready",
      runtimeInstanceId: "runtime-1",
      generation: "generation-1",
      pid: 123,
      providerSessionId: "provider-session-1",
      model: null,
      effort: null,
      permission: null,
      capabilities: null,
      exit: null,
      error: null,
    };
    const mounted = await render(
      <ManagedAgentTerminalProvider
        value={{
          threadId,
          state,
          active: true,
          available: true,
          busy: false,
          featureEnabled: true,
          start: async () => {},
          switchToChat: async () => {},
          restart: async () => {},
          stop: async () => {},
          setViewportSize: () => {},
        }}
      >
        <ManagedAgentTerminalSurface />
      </ManagedAgentTerminalProvider>,
    );

    try {
      await expect.poll(() => Boolean(listener)).toBe(true);
      const write = vi
        .spyOn(Terminal.prototype, "write")
        .mockImplementationOnce(() => {
          throw new Error("xterm write failed");
        });
      listener?.({
        type: "attached",
        threadId,
        revision: 1,
        generation: "generation-1",
        snapshot: {
          snapshotAnsi: "snapshot",
          scrollbackAnsi: "",
          rehydrateSequences: "",
          cols: 80,
          rows: 24,
          outputSequence: 0,
        },
      });

      await expect.poll(() => subscribe.mock.calls.length).toBe(2);
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      expect(subscribe).toHaveBeenCalledTimes(2);
      write.mockRestore();
    } finally {
      vi.restoreAllMocks();
      await mounted.unmount();
    }
  });

  it("resubscribes for a forward output sequence gap", async () => {
    const threadId = "gapped-terminal-output" as ThreadId;
    let listener: ((event: TerminalAgentEvent) => void) | undefined;
    const subscribe = vi.fn(
      (
        _input: TerminalAgentSubscribeInput,
        nextListener: (event: TerminalAgentEvent) => void,
      ) => {
        listener = nextListener;
        return () => {};
      },
    );
    window.nativeApi = {
      terminalAgent: {
        subscribe,
        resize: vi.fn(async () => {}),
        write: vi.fn(async () => {}),
      },
    } as unknown as NativeApi;
    const state = {
      threadId,
      authority: "terminal",
      revision: 1,
      provider: "codex",
      status: "ready",
      runtimeInstanceId: "runtime-1",
      generation: "generation-1",
      pid: 123,
      providerSessionId: null,
      model: null,
      effort: null,
      permission: null,
      capabilities: null,
      exit: null,
      error: null,
    } as TerminalAgentRuntimeState;
    const mounted = await render(
      <ManagedAgentTerminalProvider
        value={{
          threadId,
          state,
          active: true,
          available: true,
          busy: false,
          featureEnabled: true,
          start: async () => {},
          switchToChat: async () => {},
          restart: async () => {},
          stop: async () => {},
          setViewportSize: () => {},
        }}
      >
        <ManagedAgentTerminalSurface />
      </ManagedAgentTerminalProvider>,
    );

    try {
      await expect.poll(() => Boolean(listener)).toBe(true);
      listener?.({
        type: "attached",
        threadId,
        revision: 1,
        generation: "generation-1",
        snapshot: {
          snapshotAnsi: "",
          scrollbackAnsi: "",
          rehydrateSequences: "",
          cols: 80,
          rows: 24,
          outputSequence: 0,
        },
      });
      listener?.({
        type: "output",
        threadId,
        revision: 1,
        generation: "generation-1",
        seq: 2,
        data: "must-not-render",
      });

      await expect.poll(() => subscribe.mock.calls.length).toBe(2);
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      expect(subscribe).toHaveBeenCalledTimes(2);
    } finally {
      await mounted.unmount();
    }
  });
  it("drops old input promises when the browser observes a new epoch", async () => {
    const firstSend = new Promise<void>((resolve) => {
      window.setTimeout(resolve, 10);
    });
    const sent: string[] = [];
    const queue = new ManagedTerminalInputQueue(async (fence, data) => {
      sent.push(`${fence.generation}:${data}`);
      if (data === "active") await firstSend;
    }, vi.fn());

    queue.setFence({ revision: 1, generation: "generation-1" });
    queue.enqueue("active");
    queue.enqueue("stale");
    await Promise.resolve();
    queue.setFence({ revision: 2, generation: "generation-2" });
    queue.enqueue("fresh");
    await firstSend;
    await expect.poll(() => sent.length).toBe(2);

    expect(sent).toEqual(["generation-1:active", "generation-2:fresh"]);
    queue.dispose();
  });

  it("forwards keyboard sequences that resemble replies and drops synthetic replies", async () => {
    const threadId = "query-reply-terminal" as ThreadId;
    let listener: ((event: TerminalAgentEvent) => void) | undefined;
    const write = vi.fn(async () => {});
    window.nativeApi = {
      terminalAgent: {
        subscribe: (
          _input: TerminalAgentSubscribeInput,
          nextListener: (event: TerminalAgentEvent) => void,
        ) => {
          listener = nextListener;
          return () => {};
        },
        resize: vi.fn(async () => {}),
        write,
      },
    } as unknown as NativeApi;
    const state: TerminalAgentRuntimeState = {
      threadId,
      authority: "terminal",
      revision: 1,
      provider: "codex",
      status: "ready",
      runtimeInstanceId: "runtime-1",
      generation: "generation-1",
      pid: 123,
      providerSessionId: "provider-session-1",
      model: null,
      effort: null,
      permission: null,
      capabilities: null,
      exit: null,
      error: null,
    };
    const mounted = await render(
      <ManagedAgentTerminalProvider
        value={{
          threadId,
          state,
          active: true,
          available: true,
          busy: false,
          featureEnabled: true,
          start: async () => {},
          switchToChat: async () => {},
          restart: async () => {},
          stop: async () => {},
          setViewportSize: () => {},
        }}
      >
        <ManagedAgentTerminalSurface />
      </ManagedAgentTerminalProvider>,
    );

    try {
      await expect.poll(() => Boolean(listener)).toBe(true);
      listener?.({
        type: "attached",
        threadId,
        revision: 1,
        generation: "generation-1",
        snapshot: {
          snapshotAnsi: "",
          scrollbackAnsi: "",
          rehydrateSequences: "",
          cols: 80,
          rows: 24,
          outputSequence: 0,
        },
      });
      const textarea = document.querySelector<HTMLTextAreaElement>(
        ".xterm-helper-textarea",
      );
      expect(textarea).not.toBeNull();
      const keydown = new KeyboardEvent("keydown", {
        key: "F3",
        code: "F3",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperties(keydown, {
        keyCode: { value: 114 },
        which: { value: 114 },
      });
      textarea!.dispatchEvent(keydown);
      await expect.poll(() => write.mock.calls.length).toBe(1);
      expect(write.mock.calls[0]?.[0].data).toMatch(/^\u001b\[[0-9;]*R$/u);

      listener?.({
        type: "output",
        threadId,
        revision: 1,
        generation: "generation-1",
        seq: 1,
        data: "\u001b[6n",
      });
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      expect(write).toHaveBeenCalledOnce();
    } finally {
      await mounted.unmount();
    }
  });
});
