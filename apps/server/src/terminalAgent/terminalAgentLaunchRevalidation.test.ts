import { DEFAULT_SERVER_SETTINGS, ThreadId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { assertTerminalLaunchContextUnchanged } from "./terminalAgentLaunchRevalidation";

const target = {
  threadId: ThreadId.makeUnsafe("terminal-revalidation-thread"),
  provider: "codex" as const,
  modelSelection: { provider: "codex" as const, model: "gpt-5" },
  runtimeMode: "full-access" as const,
  workspaceRoot: "/workspace",
  coordinates: {
    workspaceRoot: "/workspace",
    groupId: "group-1" as never,
    sessionId: ThreadId.makeUnsafe("terminal-revalidation-thread"),
    createdAt: "2026-07-25T00:00:00.000Z",
  },
};
const enabledSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  enableManagedAgentTerminal: true,
};

describe("terminal launch revalidation", () => {
  it("accepts an unchanged target and provider configuration", () => {
    expect(() =>
      assertTerminalLaunchContextUnchanged({
        expectedTarget: target,
        expectedSettings: enabledSettings,
        currentTarget: target,
        currentSettings: enabledSettings,
      }),
    ).not.toThrow();
  });

  it("rejects stale permission, model, provider configuration, or feature state", () => {
    const cases = [
      {
        currentTarget: {
          ...target,
          runtimeMode: "approval-required" as const,
        },
        currentSettings: enabledSettings,
      },
      {
        currentTarget: {
          ...target,
          modelSelection: { provider: "codex" as const, model: "gpt-5.1" },
        },
        currentSettings: enabledSettings,
      },
      {
        currentTarget: target,
        currentSettings: {
          ...DEFAULT_SERVER_SETTINGS,
          enableManagedAgentTerminal: false,
        },
      },
      {
        currentTarget: target,
        currentSettings: {
          ...DEFAULT_SERVER_SETTINGS,
          providers: {
            ...DEFAULT_SERVER_SETTINGS.providers,
            codex: {
              ...DEFAULT_SERVER_SETTINGS.providers.codex,
              binaryPath: "/different/codex",
            },
          },
        },
      },
    ];
    for (const current of cases) {
      expect(() =>
        assertTerminalLaunchContextUnchanged({
          expectedTarget: target,
          expectedSettings: enabledSettings,
          ...current,
        }),
      ).toThrow("changed");
    }
  });
});
