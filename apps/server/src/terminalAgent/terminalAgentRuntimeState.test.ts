import type { OrchestrationMessage } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import {
  terminalProviderResumeCursor,
  terminalProviderSessionId,
  visibleTranscriptBootstrap,
} from "./terminalAgentRuntimeState";

function message(
  role: OrchestrationMessage["role"],
  text: string,
  streaming = false,
): OrchestrationMessage {
  return {
    id: "message-id",
    role,
    text,
    turnId: null,
    streaming,
    source: "native",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  } as OrchestrationMessage;
}

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

describe("visibleTranscriptBootstrap", () => {
  it("keeps only complete visible user and assistant messages", () => {
    expect(
      visibleTranscriptBootstrap([
        message("user", "Question"),
        message("assistant", "in progress", true),
        message("system", "internal"),
        message("assistant", "Answer"),
      ]),
    ).toBe("User:\nQuestion\n\nAssistant:\nAnswer");
  });

  it("bounds work and output to the recent transcript window", () => {
    const bootstrap = visibleTranscriptBootstrap([
      message("user", "OLD-PREFIX-".repeat(200_000)),
      message("assistant", "z".repeat(120_001)),
    ]);

    expect(bootstrap).not.toContain("OLD-PREFIX");
    expect(bootstrap).toBe(
      `[Earlier transcript omitted]\n\n${"z".repeat(120_000)}`,
    );
  });
});
