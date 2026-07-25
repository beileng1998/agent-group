import { describe, expect, it } from "vitest";

import {
  terminalProviderResumeCursor,
  terminalProviderSessionId,
} from "./terminalAgentRuntimeState";

describe("terminal provider resume cursors", () => {
  it("normalizes each provider's native structured-session cursor", () => {
    expect(
      terminalProviderResumeCursor("codex", { threadId: " codex-thread " }),
    ).toEqual({ threadId: "codex-thread" });
    expect(
      terminalProviderResumeCursor("claudeAgent", {
        resume: " claude-session ",
      }),
    ).toEqual({ resume: "claude-session" });
    expect(
      terminalProviderResumeCursor("pi", " /managed/pi/session.jsonl "),
    ).toBe("/managed/pi/session.jsonl");
  });

  it("derives CLI session IDs only for providers whose cursor is an ID", () => {
    expect(
      terminalProviderSessionId("codex", { threadId: "codex-thread" }),
    ).toBe("codex-thread");
    expect(
      terminalProviderSessionId("claudeAgent", {
        sessionId: "claude-session",
      }),
    ).toBe("claude-session");
    expect(
      terminalProviderSessionId("pi", "/managed/pi/session.jsonl"),
    ).toBeNull();
  });
});
