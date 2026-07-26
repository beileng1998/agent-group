import type { TerminalAgentRuntimeState } from "@agent-group/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  type ManagedAgentTerminalController,
  ManagedAgentTerminalProvider,
} from "../../agent-terminal/ManagedAgentTerminalContext";
import { AgentTerminalControl } from "./AgentTerminalControl";

function controller(
  patch: Partial<ManagedAgentTerminalController> = {},
): ManagedAgentTerminalController {
  const state = {
    threadId: "thread-terminal-control",
    authority: "structured",
    revision: 0,
    provider: "codex",
    status: "ready",
    runtimeInstanceId: null,
    generation: null,
    pid: null,
    providerSessionId: null,
    model: null,
    effort: null,
    permission: null,
    capabilities: null,
    exit: null,
    error: null,
  } as TerminalAgentRuntimeState;
  return {
    threadId: state.threadId,
    state,
    active: false,
    available: true,
    busy: false,
    pendingAction: null,
    surface: patch.active ? "terminal" : "chat",
    featureEnabled: true,
    startBlockedReason: null,
    showSurface: vi.fn(),
    start: vi.fn(),
    switchToChat: vi.fn(),
    restart: vi.fn(),
    stop: vi.fn(),
    setViewportSize: vi.fn(),
    ...patch,
  } as ManagedAgentTerminalController;
}

describe("AgentTerminalControl", () => {
  it("renders the only Chat and Terminal interface switch", () => {
    const markup = renderToStaticMarkup(
      <ManagedAgentTerminalProvider value={controller()}>
        <AgentTerminalControl />
      </ManagedAgentTerminalProvider>,
    );

    expect(markup).toContain('aria-label="Session interface"');
    expect(markup).toContain("Chat");
    expect(markup).toContain("Terminal");
    expect(markup).toContain('aria-selected="true"');
  });

  it("keeps recovery visible but prevents new starts when the flag is off", () => {
    const terminalState = {
      ...controller().state!,
      authority: "terminal" as const,
      status: "exited" as const,
      runtimeInstanceId: "runtime-1",
      generation: "generation-1",
    };
    const markup = renderToStaticMarkup(
      <ManagedAgentTerminalProvider
        value={controller({
          state: terminalState,
          active: true,
          available: true,
          featureEnabled: false,
        })}
      >
        <AgentTerminalControl />
      </ManagedAgentTerminalProvider>,
    );

    expect(markup).toContain("Terminal");
    expect(markup).toContain('aria-selected="true"');
    expect(markup).not.toContain(
      "Managed Agent Terminal is disabled for new sessions",
    );
  });

  it("stays absent when the feature is off and structured authority owns the thread", () => {
    const markup = renderToStaticMarkup(
      <ManagedAgentTerminalProvider
        value={controller({ available: false, featureEnabled: false })}
      >
        <AgentTerminalControl />
      </ManagedAgentTerminalProvider>,
    );

    expect(markup).toBe("");
  });

  it("keeps Chat history reachable while the terminal Turn is running", () => {
    const terminalState = {
      ...controller().state!,
      authority: "terminal" as const,
      status: "running" as const,
      runtimeInstanceId: "runtime-running",
      generation: "generation-running",
    };
    const markup = renderToStaticMarkup(
      <ManagedAgentTerminalProvider
        value={controller({
          state: terminalState,
          active: true,
        })}
      >
        <AgentTerminalControl />
      </ManagedAgentTerminalProvider>,
    );

    expect(markup).not.toMatch(
      /<button[^>]*disabled=""[^>]*title="Show Chat history"/s,
    );
  });

  it("shows why Terminal cannot start while Chat is running", () => {
    const reason =
      "Stop or wait for the current Chat turn before opening Terminal.";
    const markup = renderToStaticMarkup(
      <ManagedAgentTerminalProvider
        value={controller({ startBlockedReason: reason })}
      >
        <AgentTerminalControl />
      </ManagedAgentTerminalProvider>,
    );

    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain(`title="${reason}"`);
    expect(markup).toContain(reason);
    expect(markup).toContain('aria-selected="true"');
  });
});
