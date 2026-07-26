import type {
  NativeApi,
  TerminalAgentEvent,
  TerminalAgentRuntimeState,
  TerminalAgentSubscribeInput,
  ThreadId,
} from "@agent-group/contracts";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  ManagedAgentTerminalProvider,
  type ManagedAgentTerminalSurface as Surface,
} from "./ManagedAgentTerminalContext";
import { ManagedAgentTerminalSurface } from "./ManagedAgentTerminalSurface";

const originalNativeApi = window.nativeApi;

function terminalState(threadId: ThreadId): TerminalAgentRuntimeState {
  return {
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
}

describe("managed Agent Terminal input and parking", () => {
  afterEach(() => {
    window.nativeApi = originalNativeApi;
    document.body.innerHTML = "";
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
    const state = terminalState(threadId);
    const mounted = await render(
      <ManagedAgentTerminalProvider
        value={{
          threadId,
          state,
          active: true,
          available: true,
          busy: false,
          pendingAction: null,
          surface: "terminal",
          featureEnabled: true,
          showSurface: () => {},
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
      await expect
        .poll(() => document.body.textContent?.includes("Connected"))
        .toBe(true);
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

  it("reuses one renderer and stream across Chat and Terminal views", async () => {
    const threadId = "parked-managed-terminal" as ThreadId;
    const subscribe = vi.fn(() => () => {});
    window.nativeApi = {
      terminalAgent: {
        subscribe,
        resize: vi.fn(async () => {}),
        write: vi.fn(async () => {}),
      },
    } as unknown as NativeApi;
    const state = terminalState(threadId);

    function Harness() {
      const [surface, setSurface] = useState<Surface>("terminal");
      return (
        <ManagedAgentTerminalProvider
          value={{
            threadId,
            state,
            active: true,
            available: true,
            busy: false,
            pendingAction: null,
            surface,
            featureEnabled: true,
            showSurface: setSurface,
            start: async () => {},
            switchToChat: async () => {},
            restart: async () => {},
            stop: async () => {},
            setViewportSize: () => {},
          }}
        >
          <button type="button" onClick={() => setSurface("chat")}>
            Show Chat
          </button>
          <button type="button" onClick={() => setSurface("terminal")}>
            Show Terminal
          </button>
          <ManagedAgentTerminalSurface />
        </ManagedAgentTerminalProvider>
      );
    }

    const mounted = await render(<Harness />);
    try {
      await expect.poll(() => subscribe.mock.calls.length).toBe(1);
      const renderer = document.querySelector(".xterm");
      expect(renderer).not.toBeNull();
      document.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      const parkingContainer = document.getElementById("agent-group-terminal-parking");
      expect(parkingContainer?.hasAttribute("inert")).toBe(true);
      expect(parkingContainer?.contains(renderer)).toBe(true);
      const buttons = document.querySelectorAll<HTMLButtonElement>("button");
      buttons[1]?.click();
      await expect.poll(() => document.querySelector(".xterm")).toBe(renderer);
      expect(subscribe).toHaveBeenCalledOnce();
    } finally {
      await mounted.unmount();
    }
  });
});
