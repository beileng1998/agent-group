import { describe, expect, it } from "vitest";

import {
  codexHookInputToTerminalEvent,
  encodeCodexHookResponse,
  parseCodexHookBridgeRequest,
  parseCodexHookInput,
} from "./codexHookProtocol";
import {
  parseClaudeHookBridgeRequest,
  parseClaudeHookInput,
  parseClaudeStatusLine,
} from "./claudeHookProtocol";
import { parsePiTerminalEvent } from "./piTerminalProtocol";

const codexCommon = {
  session_id: "019f0000-0000-7000-8000-000000000001",
  transcript_path: "/tmp/codex-rollout.jsonl",
  cwd: "/workspace",
  model: "gpt-5.6",
  permission_mode: "default",
};

describe("managed terminal protocols", () => {
  it("parses the Codex 0.144.6 lifecycle and canonical prompt event", () => {
    const sessionStart = parseCodexHookInput({
        ...codexCommon,
        hook_event_name: "SessionStart",
        source: "resume",
      });
    expect(sessionStart).toMatchObject({
      hook_event_name: "SessionStart",
      source: "resume",
    });
    expect(codexHookInputToTerminalEvent(sessionStart)).toMatchObject({
      type: "session_start",
      providerResumeCursor: { threadId: codexCommon.session_id },
    });
    const request = parseCodexHookBridgeRequest({
      runtimeInstanceId: "runtime-1",
      eventId: "event-1",
      input: {
        ...codexCommon,
        hook_event_name: "UserPromptSubmit",
        turn_id: "turn-1",
        prompt: "",
      },
    });
    expect(
      codexHookInputToTerminalEvent(request.input, request.eventId),
    ).toEqual({
      eventId: "event-1",
      type: "prompt_submit",
      prompt: "",
      providerTurnId: "turn-1",
      model: "gpt-5.6",
      permissionMode: "default",
    });
  });

  it("rejects incomplete Codex hooks and unsupported bridge modes", () => {
    expect(() =>
      parseCodexHookInput({
        ...codexCommon,
        hook_event_name: "UserPromptSubmit",
        prompt: "Missing turn id.",
      }),
    ).toThrow("turn id");
    expect(() =>
      parseCodexHookBridgeRequest({
        runtimeInstanceId: "runtime-1",
        mode: "status-line",
        input: {
          ...codexCommon,
          hook_event_name: "Stop",
          turn_id: "turn-1",
          stop_hook_active: false,
          last_assistant_message: null,
        },
      }),
    ).toThrow("bridge mode");
  });

  it("encodes only native Codex hook responses", () => {
    expect(
      encodeCodexHookResponse("UserPromptSubmit", {
        additionalContext: "Context.",
      }),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "Context.",
      },
    });
    expect(
      encodeCodexHookResponse("UserPromptSubmit", {
        block: { message: "Unavailable." },
      }),
    ).toEqual({ decision: "block", reason: "Unavailable." });
    expect(() =>
      encodeCodexHookResponse("Stop", { additionalContext: "No." }),
    ).toThrow("does not accept");
  });

  it("parses Claude hooks and rejects unknown wrapper modes", () => {
    const request = parseClaudeHookBridgeRequest({
      runtimeInstanceId: "runtime-1",
      eventId: "event-1",
      mode: "status-line",
      input: {
        model: { id: "claude-sonnet-5" },
        effort: { level: "high" },
        permission_mode: "manual",
      },
    });
    const status = parseClaudeHookInput(request.input, request.mode);
    expect(parseClaudeStatusLine(status)).toEqual({
      model: "claude-sonnet-5",
      effort: "high",
      permissionMode: "manual",
    });
    expect(() =>
      parseClaudeHookBridgeRequest({
        runtimeInstanceId: "runtime-1",
        mode: "prompt-accepted",
        input: {},
      }),
    ).toThrow("mode");
  });

  it("parses strict Pi lifecycle payloads", () => {
    expect(
      parsePiTerminalEvent({
        event_name: "session_start",
        event_id: "event-1",
        session_id: "session-1",
        session_file: "/sessions/session-1.jsonl",
        reason: "startup",
        model: "anthropic/claude-sonnet-4-5",
        permission_mode: "approval-required",
      }),
    ).toMatchObject({
      event_name: "session_start",
      session_id: "session-1",
      model: "anthropic/claude-sonnet-4-5",
    });
    expect(() =>
      parsePiTerminalEvent({
        event_name: "prompt_submit",
        event_id: "event-2",
      }),
    ).toThrow("prompt");
  });
});
