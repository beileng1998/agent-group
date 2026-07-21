import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  buildSubagentIdentityDirectory,
  decodeSubagentReceiverThreadIds,
  extractSubagentIdentityHints,
} from "@agent-group/shared/subagents";
import { describe, expect, it } from "vitest";

import {
  buildClaudeSubagentReceiverMetadata,
  claudeSubagentTurnStatus,
  ClaudeSubagentRouteRegistry,
  normalizeClaudeSubagentTerminalStatus,
  readClaudeSubagentParentToolUseId,
} from "./claudeSubagentRouting.ts";

function asSdkMessage(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage;
}

describe("readClaudeSubagentParentToolUseId", () => {
  it.each(["assistant", "user", "stream_event", "tool_progress"])(
    "reads a non-empty parent id from %s messages",
    (type) => {
      expect(
        readClaudeSubagentParentToolUseId(
          asSdkMessage({ type, parent_tool_use_id: "  tool-subagent-1  " }),
        ),
      ).toBe("tool-subagent-1");
    },
  );

  it("ignores empty ids and message kinds that cannot carry subagent traffic", () => {
    expect(
      readClaudeSubagentParentToolUseId(
        asSdkMessage({ type: "assistant", parent_tool_use_id: "   " }),
      ),
    ).toBeUndefined();
    expect(
      readClaudeSubagentParentToolUseId(
        asSdkMessage({
          type: "system",
          subtype: "status",
          parent_tool_use_id: "tool-subagent-1",
        }),
      ),
    ).toBeUndefined();
  });
});

describe("buildClaudeSubagentReceiverMetadata", () => {
  it("builds metadata consumed by the shared subagent identity decoders", () => {
    const metadata = buildClaudeSubagentReceiverMetadata({
      itemId: "tool-subagent-1",
      input: {
        subagent_type: "code-reviewer",
        description: "Migration reviewer",
        prompt: "Review the persistence migration",
        model: "sonnet",
        run_in_background: true,
      },
    });

    expect(metadata).toEqual({
      receiverThreadId: "tool-subagent-1",
      agentType: "code-reviewer",
      nickname: "Migration reviewer",
      prompt: "Review the persistence migration",
      model: "sonnet",
      background: true,
    });
    expect(decodeSubagentReceiverThreadIds(metadata)).toEqual(["tool-subagent-1"]);

    const directory = buildSubagentIdentityDirectory(extractSubagentIdentityHints(metadata!));
    expect(directory.byProviderThreadId.get("tool-subagent-1")).toMatchObject({
      providerThreadId: "tool-subagent-1",
      nickname: "Migration reviewer",
      role: "code-reviewer",
      prompt: "Review the persistence migration",
      model: "sonnet",
    });
  });

  it("omits blank hints and false background flags", () => {
    expect(
      buildClaudeSubagentReceiverMetadata({
        itemId: " tool-subagent-2 ",
        input: {
          subagent_type: " ",
          description: "",
          prompt: null,
          model: 42,
          run_in_background: false,
        },
      }),
    ).toEqual({ receiverThreadId: "tool-subagent-2" });
    expect(buildClaudeSubagentReceiverMetadata({ itemId: "   ", input: {} })).toBeUndefined();
  });
});

describe("Claude subagent terminal status", () => {
  it.each([
    ["completed", "completed", "completed"],
    ["failed", "failed", "failed"],
    ["stopped", "stopped", "interrupted"],
    ["killed", "stopped", "interrupted"],
  ] as const)(
    "normalizes %s to %s and maps it to turn status %s",
    (rawStatus, normalizedStatus, turnStatus) => {
      const normalized = normalizeClaudeSubagentTerminalStatus(rawStatus);
      expect(normalized).toBe(normalizedStatus);
      expect(claudeSubagentTurnStatus(normalized!)).toBe(turnStatus);
    },
  );

  it.each(["pending", "running", "paused", undefined, null])(
    "does not treat %s as terminal",
    (status) => {
      expect(normalizeClaudeSubagentTerminalStatus(status)).toBeUndefined();
    },
  );
});

describe("ClaudeSubagentRouteRegistry", () => {
  it("resolves a bound route in both directions", () => {
    const registry = new ClaudeSubagentRouteRegistry();

    expect(registry.registerToolUse("tool-1")).toEqual({ toolUseId: "tool-1" });
    expect(registry.bindTask("tool-1", "task-1")).toEqual({
      route: { toolUseId: "tool-1", taskId: "task-1" },
      stopRequested: false,
    });
    expect(registry.resolveActive({ toolUseId: "tool-1" })).toEqual({
      toolUseId: "tool-1",
      taskId: "task-1",
    });
    expect(registry.resolveActive({ taskId: "task-1" })).toEqual({
      toolUseId: "tool-1",
      taskId: "task-1",
    });
  });

  it("queues an early stop and consumes it when the task id arrives", () => {
    const registry = new ClaudeSubagentRouteRegistry();

    expect(registry.requestStop("tool-early-stop")).toEqual({
      kind: "pending",
      toolUseId: "tool-early-stop",
    });
    expect(registry.bindTask("tool-early-stop", "task-early-stop")).toEqual({
      route: { toolUseId: "tool-early-stop", taskId: "task-early-stop" },
      stopRequested: true,
    });
    expect(registry.requestStop("tool-early-stop")).toEqual({
      kind: "ready",
      toolUseId: "tool-early-stop",
      taskId: "task-early-stop",
    });
  });

  it("keeps one-to-one tool and task bindings", () => {
    const registry = new ClaudeSubagentRouteRegistry();
    registry.bindTask("tool-1", "task-1");

    expect(registry.bindTask("tool-1", "task-2")).toBeUndefined();
    expect(registry.bindTask("tool-2", "task-1")).toBeUndefined();
    expect(registry.settle({ toolUseId: "tool-2", taskId: "task-1" }, "completed")).toBeUndefined();
    expect(registry.resolveActive({ toolUseId: "tool-1", taskId: "task-2" })).toBeUndefined();
    expect(registry.resolveActive({ toolUseId: "tool-2" })).toBeUndefined();
    expect(registry.resolveActive({ taskId: "task-1" })).toEqual({
      toolUseId: "tool-1",
      taskId: "task-1",
    });
  });

  it("settles by task id and prevents late messages from reopening the route", () => {
    const registry = new ClaudeSubagentRouteRegistry();
    registry.bindTask("tool-zombie", "task-zombie");

    expect(registry.settle({ taskId: "task-zombie" }, "killed")).toEqual({
      route: { toolUseId: "tool-zombie", taskId: "task-zombie" },
      status: "stopped",
    });
    expect(registry.settledStatus({ toolUseId: "tool-zombie" })).toBe("stopped");
    expect(registry.settledStatus({ taskId: "task-zombie" })).toBe("stopped");
    expect(registry.resolveActive({ toolUseId: "tool-zombie" })).toBeUndefined();
    expect(registry.resolve({ taskId: "task-zombie" })).toEqual({
      toolUseId: "tool-zombie",
      taskId: "task-zombie",
    });
    expect(registry.registerToolUse("tool-zombie")).toBeUndefined();
    expect(registry.bindTask("tool-zombie", "task-zombie")).toBeUndefined();
    expect(registry.requestStop("tool-zombie")).toEqual({
      kind: "settled",
      toolUseId: "tool-zombie",
      status: "stopped",
    });
  });

  it("records a terminal event even when task_started was missed", () => {
    const registry = new ClaudeSubagentRouteRegistry();

    expect(
      registry.settle({ toolUseId: "tool-missed-start", taskId: "task-missed-start" }, "completed"),
    ).toEqual({
      route: { toolUseId: "tool-missed-start", taskId: "task-missed-start" },
      status: "completed",
    });
    expect(registry.registerToolUse("tool-missed-start")).toBeUndefined();
  });
});
