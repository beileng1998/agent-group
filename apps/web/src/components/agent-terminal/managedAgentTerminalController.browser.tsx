import type {
  NativeApi,
  ServerSettings,
  TerminalAgentRuntimeState,
  ThreadId,
} from "@agent-group/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useManagedAgentTerminalController } from "../../hooks/useManagedAgentTerminalController";
import { serverQueryKeys } from "../../lib/serverReactQuery";

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

const originalNativeApi = window.nativeApi;

afterEach(() => {
  window.nativeApi = originalNativeApi;
  document.body.innerHTML = "";
});

describe("managed Agent Terminal controller", () => {
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
