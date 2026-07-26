import { describe, expect, it } from "vitest";

import {
  parseClaudeHookBridgeRequest,
  parseClaudeHookInput,
  parseClaudeStatusLine,
} from "./claudeHookProtocol";
import { parseCodexHookBridgeRequest, parseCodexHookInput } from "./codexHookProtocol";
import { parsePiTerminalEvent } from "./piTerminalProtocol";
import { parseTerminalAgentBridgeRequest } from "./terminalAgentBridgeBudget";

const providerLimit = "m".repeat(512);
const oversizedProviderValue = "m".repeat(513);
const oversizedRuntimeId = "r".repeat(129);

const codexBase = {
  hook_event_name: "SessionStart",
  session_id: "session-1",
  transcript_path: null,
  cwd: "/workspace",
  permission_mode: "default",
  source: "startup",
};

describe("managed terminal hook protocol bounds", () => {
  it("accepts provider metadata at the public 512-character limit", () => {
    expect(parseCodexHookInput({ ...codexBase, model: providerLimit }).model).toBe(providerLimit);
    expect(
      parseClaudeHookInput({
        hook_event_name: "SessionStart",
        session_id: "session-1",
        model: providerLimit,
      }).model,
    ).toBe(providerLimit);
    expect(
      parsePiTerminalEvent({
        event_name: "runtime_state",
        event_id: "event-1",
        model: providerLimit,
      }),
    ).toMatchObject({ model: providerLimit });
  });

  it("rejects oversized Codex provider metadata before projection", () => {
    expect(() =>
      parseCodexHookInput({
        ...codexBase,
        model: oversizedProviderValue,
      }),
    ).toThrow("maximum length is 512");
  });

  it("rejects oversized Claude provider metadata before projection", () => {
    expect(() =>
      parseClaudeHookInput({
        hook_event_name: "SessionStart",
        session_id: "session-1",
        model: oversizedProviderValue,
      }),
    ).toThrow("maximum length is 512");
    const status = parseClaudeHookInput({ model: { id: oversizedProviderValue } }, "status-line");
    expect(() => parseClaudeStatusLine(status)).toThrow("maximum length is 512");
  });

  it("rejects oversized Pi provider metadata before projection", () => {
    expect(() =>
      parsePiTerminalEvent({
        event_name: "runtime_state",
        event_id: "event-1",
        permission_mode: oversizedProviderValue,
      }),
    ).toThrow("maximum length is 512");
  });

  it("enforces the 128-character runtime and event identifier budget", () => {
    expect(() =>
      parseTerminalAgentBridgeRequest({
        runtimeInstanceId: oversizedRuntimeId,
        input: {},
      }),
    ).toThrow("too long");
    expect(() =>
      parseCodexHookBridgeRequest({
        runtimeInstanceId: oversizedRuntimeId,
        input: { ...codexBase, model: "gpt-5" },
      }),
    ).toThrow("maximum length is 128");
    expect(() =>
      parseClaudeHookBridgeRequest({
        runtimeInstanceId: "runtime-1",
        eventId: oversizedRuntimeId,
        input: {},
      }),
    ).toThrow("maximum length is 128");
    expect(() =>
      parsePiTerminalEvent({
        event_name: "runtime_state",
        event_id: oversizedRuntimeId,
      }),
    ).toThrow("maximum length is 128");
  });
});
