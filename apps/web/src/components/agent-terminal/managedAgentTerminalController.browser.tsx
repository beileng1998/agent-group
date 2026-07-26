import type {
  NativeApi,
  ServerSettings,
  TerminalAgentRuntimeState,
  ThreadId,
} from "@agent-group/contracts";
import "../../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useManagedAgentTerminalController } from "../../hooks/useManagedAgentTerminalController";
import { serverQueryKeys } from "../../lib/serverReactQuery";
import { AgentTerminalControl } from "../chat/header/AgentTerminalControl";
import { ManagedAgentTerminalControllerProvider } from "./ManagedAgentTerminalContext";

const THREAD_ID = "managed-terminal-stop-browser" as ThreadId;
const TERMINAL_STATE: TerminalAgentRuntimeState = {
  threadId: THREAD_ID,
  authority: "terminal",
  revision: 4,
  provider: "codex",
  status: "ready",
  runtimeInstanceId: "runtime-1",
  generation: "generation-1",
  pid: 123,
  providerSessionId: "provider-session-1",
  model: "gpt-5",
  effort: "medium",
  permission: null,
  capabilities: null,
  exit: null,
  error: null,
};
const STRUCTURED_STATE: TerminalAgentRuntimeState = {
  ...TERMINAL_STATE,
  authority: "structured",
  revision: 0,
  runtimeInstanceId: null,
  generation: null,
  pid: null,
  providerSessionId: null,
};

const originalNativeApi = window.nativeApi;

afterEach(() => {
  window.nativeApi = originalNativeApi;
  document.body.innerHTML = "";
});

describe("managed Agent Terminal controller", () => {
  it("keeps Chat selected and explains when a live Chat turn blocks Terminal", async () => {
    const start = vi.fn(async () => TERMINAL_STATE);
    window.nativeApi = {
      terminalAgent: {
        get: async () => STRUCTURED_STATE,
        subscribe: (_input, listener) => {
          listener({ type: "state", state: STRUCTURED_STATE });
          return () => {};
        },
        start,
      },
    } as unknown as NativeApi;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(serverQueryKeys.settings(), {
      enableManagedAgentTerminal: true,
    } as ServerSettings);
    const blockedReason =
      "Stop or wait for the current Chat turn before opening Terminal.";

    function Harness() {
      const controller = useManagedAgentTerminalController({
        threadId: THREAD_ID,
        provider: "codex",
        serverBacked: true,
        startBlockedReason: blockedReason,
      });
      return (
        <ManagedAgentTerminalControllerProvider controller={controller}>
          <AgentTerminalControl />
        </ManagedAgentTerminalControllerProvider>
      );
    }

    const mounted = await render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
    try {
      const chat = page.getByRole("tab", { name: "Chat" });
      const terminal = page.getByRole("tab", { name: "Terminal" });
      await expect.element(chat).toHaveAttribute("aria-selected", "true");
      await expect.element(terminal).toHaveAttribute("aria-disabled", "true");
      expect(terminal.element().title).toBe(blockedReason);
      terminal.element().click();
      await expect.element(chat).toHaveAttribute("aria-selected", "true");
      expect(start).not.toHaveBeenCalled();
    } finally {
      await mounted.unmount();
      queryClient.clear();
    }
  });

  it("changes the visible surface without stopping the Terminal runtime", async () => {
    const switchToChat = vi.fn(async () => ({
      ...TERMINAL_STATE,
      authority: "structured" as const,
    }));
    window.nativeApi = {
      terminalAgent: {
        get: async () => TERMINAL_STATE,
        subscribe: (_input, listener) => {
          listener({ type: "state", state: TERMINAL_STATE });
          return () => {};
        },
        switchToChat,
      },
    } as unknown as NativeApi;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(serverQueryKeys.settings(), {
      enableManagedAgentTerminal: true,
    } as ServerSettings);
    let ownerRenderCount = 0;

    function Harness() {
      ownerRenderCount += 1;
      const controller = useManagedAgentTerminalController({
        threadId: THREAD_ID,
        provider: "codex",
        serverBacked: true,
      });
      return (
        <ManagedAgentTerminalControllerProvider controller={controller}>
          <AgentTerminalControl />
        </ManagedAgentTerminalControllerProvider>
      );
    }

    const mounted = await render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
    try {
      const chat = page.getByRole("tab", { name: "Chat" });
      const terminal = page.getByRole("tab", { name: "Terminal" });
      await expect.element(chat).toHaveAttribute("aria-selected", "false");
      const chatElement = chat.element();
      const terminalElement = terminal.element();
      const chatRect = chatElement.getBoundingClientRect();
      const terminalRect = terminalElement.getBoundingClientRect();
      expect(chatRect.height).toBe(24);
      expect(terminalRect.height).toBe(24);
      expect(
        Math.abs(
          chatRect.top +
            chatRect.height / 2 -
            (terminalRect.top + terminalRect.height / 2),
        ),
      ).toBeLessThan(0.5);
      expect(chatElement.scrollHeight).toBeLessThanOrEqual(
        chatElement.clientHeight,
      );
      const rendersBeforeSwitch = ownerRenderCount;
      await chat.click();
      await expect.element(chat).toHaveAttribute("aria-selected", "true");
      expect(ownerRenderCount).toBe(rendersBeforeSwitch);
      expect(switchToChat).not.toHaveBeenCalled();
    } finally {
      await mounted.unmount();
      queryClient.clear();
    }
  });

  it("does not leave Chat before the server accepts Terminal authority", async () => {
    const start = vi.fn(async () => {
      throw new Error("Chat turn is already running.");
    });
    window.nativeApi = {
      terminalAgent: {
        get: async () => STRUCTURED_STATE,
        subscribe: (_input, listener) => {
          listener({ type: "state", state: STRUCTURED_STATE });
          return () => {};
        },
        start,
      },
    } as unknown as NativeApi;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(serverQueryKeys.settings(), {
      enableManagedAgentTerminal: true,
    } as ServerSettings);

    function Harness() {
      const controller = useManagedAgentTerminalController({
        threadId: THREAD_ID,
        provider: "codex",
        serverBacked: true,
      });
      return (
        <ManagedAgentTerminalControllerProvider controller={controller}>
          <AgentTerminalControl />
        </ManagedAgentTerminalControllerProvider>
      );
    }

    const mounted = await render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
    try {
      const chat = page.getByRole("tab", { name: "Chat" });
      const terminal = page.getByRole("tab", { name: "Terminal" });
      await expect.element(chat).toHaveAttribute("aria-selected", "true");
      await terminal.click();
      await expect.poll(() => start.mock.calls.length).toBe(1);
      await expect.element(chat).toHaveAttribute("aria-selected", "true");
      await expect.element(terminal).toHaveAttribute("aria-selected", "false");
    } finally {
      await mounted.unmount();
      queryClient.clear();
    }
  });

  it("honors a newer Chat intent while Terminal startup is pending", async () => {
    let resolveStart: (state: TerminalAgentRuntimeState) => void = () => {};
    const start = vi.fn(
      () =>
        new Promise<TerminalAgentRuntimeState>((resolve) => {
          resolveStart = resolve;
        }),
    );
    window.nativeApi = {
      terminalAgent: {
        get: async () => STRUCTURED_STATE,
        subscribe: (_input, listener) => {
          listener({ type: "state", state: STRUCTURED_STATE });
          return () => {};
        },
        start,
      },
    } as unknown as NativeApi;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(serverQueryKeys.settings(), {
      enableManagedAgentTerminal: true,
    } as ServerSettings);

    function Harness() {
      const controller = useManagedAgentTerminalController({
        threadId: THREAD_ID,
        provider: "codex",
        serverBacked: true,
      });
      return (
        <ManagedAgentTerminalControllerProvider controller={controller}>
          <AgentTerminalControl />
        </ManagedAgentTerminalControllerProvider>
      );
    }

    const mounted = await render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
    try {
      const chat = page.getByRole("tab", { name: "Chat" });
      const terminal = page.getByRole("tab", { name: "Terminal" });
      await terminal.click();
      await expect.poll(() => start.mock.calls.length).toBe(1);
      await chat.click();
      resolveStart(TERMINAL_STATE);
      await expect.element(chat).toHaveAttribute("aria-selected", "true");
      await expect.element(terminal).toHaveAttribute("aria-selected", "false");
    } finally {
      await mounted.unmount();
      queryClient.clear();
    }
  });

  it("never exposes the previous Thread's Terminal authority after navigation", async () => {
    const nextThreadId = "managed-terminal-next-thread" as ThreadId;
    const structuredState: TerminalAgentRuntimeState = {
      ...TERMINAL_STATE,
      threadId: nextThreadId,
      authority: "structured",
      revision: 0,
      runtimeInstanceId: null,
      generation: null,
      pid: null,
      providerSessionId: null,
    };
    window.nativeApi = {
      terminalAgent: {
        get: async ({ threadId }) =>
          threadId === THREAD_ID ? TERMINAL_STATE : structuredState,
        subscribe: ({ threadId }, listener) => {
          listener({
            type: "state",
            state: threadId === THREAD_ID ? TERMINAL_STATE : structuredState,
          });
          return () => {};
        },
      },
    } as unknown as NativeApi;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(serverQueryKeys.settings(), {
      enableManagedAgentTerminal: true,
    } as ServerSettings);
    const renders: Array<{
      threadId: ThreadId;
      stateThreadId: ThreadId | null;
      active: boolean;
    }> = [];

    function Harness() {
      const [threadId, setThreadId] = useState(THREAD_ID);
      const controller = useManagedAgentTerminalController({
        threadId,
        provider: "codex",
        serverBacked: true,
      });
      renders.push({
        threadId,
        stateThreadId: controller.state?.threadId ?? null,
        active: controller.active,
      });
      return (
        <>
          <span>{`${threadId}:${controller.active ? "terminal" : "chat"}`}</span>
          <button type="button" onClick={() => setThreadId(nextThreadId)}>
            Open next Thread
          </button>
        </>
      );
    }

    const mounted = await render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
    try {
      await expect
        .poll(() => document.body.textContent?.includes(`${THREAD_ID}:terminal`))
        .toBe(true);
      await page.getByRole("button", { name: "Open next Thread" }).click();
      await expect
        .poll(() => document.body.textContent?.includes(`${nextThreadId}:chat`))
        .toBe(true);
      const nextThreadRenders = renders.filter(
        (rendered) => rendered.threadId === nextThreadId,
      );
      expect(nextThreadRenders.length).toBeGreaterThan(0);
      expect(
        nextThreadRenders.every(
          (rendered) =>
            !rendered.active &&
            (rendered.stateThreadId === null ||
              rendered.stateThreadId === nextThreadId),
        ),
      ).toBe(true);
    } finally {
      await mounted.unmount();
      queryClient.clear();
    }
  });

  it("routes Stop through the canonical session-stop command", async () => {
    const dispatchCommand = vi.fn(async () => ({ sequence: 1 }));
    const rawTerminalStop = vi.fn(async () => TERMINAL_STATE);
    window.nativeApi = {
      orchestration: { dispatchCommand },
      terminalAgent: {
        get: async () => TERMINAL_STATE,
        subscribe: (_input, listener) => {
          listener({ type: "state", state: TERMINAL_STATE });
          return () => {};
        },
        stop: rawTerminalStop,
      },
    } as unknown as NativeApi;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(serverQueryKeys.settings(), {
      enableManagedAgentTerminal: true,
    } as ServerSettings);

    function Harness() {
      const controller = useManagedAgentTerminalController({
        threadId: THREAD_ID,
        provider: "codex",
        serverBacked: true,
      });
      return (
        <button type="button" onClick={() => void controller.stop()}>
          Stop managed terminal
        </button>
      );
    }

    const mounted = await render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
    try {
      await page.getByRole("button", { name: "Stop managed terminal" }).click();
      await expect.poll(() => dispatchCommand.mock.calls.length).toBe(1);
      expect(dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
        type: "thread.session.stop",
        threadId: THREAD_ID,
      });
      expect(rawTerminalStop).not.toHaveBeenCalled();
    } finally {
      await mounted.unmount();
      queryClient.clear();
    }
  });
});
