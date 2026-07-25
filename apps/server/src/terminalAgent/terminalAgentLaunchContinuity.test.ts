import {
  type ProviderSession,
  ThreadId,
} from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import {
  resolveAvailableTerminalLaunchContinuity,
  resolveTerminalLaunchContinuity,
} from "./terminalAgentLaunchContinuity";

const threadId = ThreadId.makeUnsafe("terminal-continuity-thread");
const session = (
  provider: ProviderSession["provider"],
  resumeCursor: unknown,
): ProviderSession => ({
  provider,
  status: "closed",
  runtimeMode: "approval-required",
  threadId,
  resumeCursor,
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:00.000Z",
});

describe("terminal launch continuity", () => {
  it.each([
    [
      "codex",
      { threadId: "codex-thread" },
      "codex-thread",
      { threadId: "codex-thread" },
    ],
    [
      "claudeAgent",
      { resume: "claude-session" },
      "claude-session",
      { resume: "claude-session" },
    ],
  ] as const)("prefers a persisted %s cursor when entering Terminal", (
    provider,
    resumeCursor,
    expectedSessionId,
    expectedCursor,
  ) => {
    expect(
      resolveTerminalLaunchContinuity({
        sessions: [session(provider, resumeCursor)],
        threadId,
        provider,
        operation: "start",
        providerSessionId: "fresh-session",
        resume: false,
      }),
    ).toEqual({
      providerSessionId: expectedSessionId,
      providerResumeCursor: expectedCursor,
      resume: true,
    });
  });

  it("uses Pi's file cursor for entry and stable session id for restart", () => {
    const sessions = [session("pi", "/managed/pi/session.jsonl")];
    expect(
      resolveTerminalLaunchContinuity({
        sessions,
        threadId,
        provider: "pi",
        operation: "start",
        providerSessionId: "fresh-pi-id",
        resume: false,
      }),
    ).toEqual({
      providerSessionId: null,
      providerResumeCursor: "/managed/pi/session.jsonl",
      resume: true,
    });
    expect(
      resolveTerminalLaunchContinuity({
        sessions,
        threadId,
        provider: "pi",
        operation: "restart",
        providerSessionId: "stable-pi-id",
        resume: true,
      }),
    ).toEqual({
      providerSessionId: "stable-pi-id",
      providerResumeCursor: null,
      resume: true,
    });
  });

  it("treats Pi's unflushed candidate path as a fresh session", async () => {
    await expect(
      resolveAvailableTerminalLaunchContinuity({
        sessions: [session("pi", "/missing/pi/session.jsonl")],
        threadId,
        provider: "pi",
        operation: "start",
        providerSessionId: "fresh-pi-id",
        resume: false,
      }),
    ).resolves.toEqual({
      providerSessionId: "fresh-pi-id",
      providerResumeCursor: null,
      resume: false,
    });
  });
});
