import { describe, expect, it, vi } from "vitest";
import { ApprovalRequestId, ThreadId } from "@agent-group/contracts";

import { CodexAppServerManager } from "./codexAppServerManager.ts";

function createHarness() {
  const manager = new CodexAppServerManager();
  const context = {
    session: {
      provider: "codex",
      status: "running",
      threadId: ThreadId.makeUnsafe("thread-1"),
      runtimeMode: "full-access",
      model: "gpt-5.3-codex",
      activeTurnId: "turn-parent",
      resumeCursor: { threadId: "provider-parent" },
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    },
    account: {
      type: "unknown",
      planType: null,
      sparkEnabled: true,
    },
    pending: new Map(),
    pendingApprovals: new Map(),
    pendingUserInputs: new Map(),
    collabReceiverTurns: new Map<string, string>(),
    collabReceiverParents: new Map<string, string>(),
    reviewTurnIds: new Set<string>(),
    nextRequestId: 1,
    stopping: false,
  };
  const emitEvent = vi
    .spyOn(manager as unknown as { emitEvent: (...args: unknown[]) => void }, "emitEvent")
    .mockImplementation(() => {});
  const writeMessage = vi
    .spyOn(manager as unknown as { writeMessage: (...args: unknown[]) => void }, "writeMessage")
    .mockImplementation(() => {});
  vi.spyOn(
    manager as unknown as { requireSession: (threadId: ThreadId) => unknown },
    "requireSession",
  ).mockReturnValue(context);

  return { manager, context, emitEvent, writeMessage };
}

function notify(
  manager: CodexAppServerManager,
  context: unknown,
  notification: Record<string, unknown>,
): void {
  (
    manager as unknown as {
      handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
    }
  ).handleServerNotification(context, notification);
}

function request(
  manager: CodexAppServerManager,
  context: unknown,
  serverRequest: Record<string, unknown>,
): void {
  (
    manager as unknown as {
      handleServerRequest: (context: unknown, request: Record<string, unknown>) => void;
    }
  ).handleServerRequest(context, serverRequest);
}

describe("CodexAppServerManager subagent routing", () => {
  it("annotates early child output with the active provider parent", () => {
    const { manager, context, emitEvent } = createHarness();

    notify(manager, context, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "provider-child",
        turnId: "turn-child",
        itemId: "message-child",
        delta: "working",
      },
    });

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "item/agentMessage/delta",
        turnId: "turn-child",
        itemId: "message-child",
        providerThreadId: "provider-child",
        providerParentThreadId: "provider-parent",
      }),
    );
  });

  it("keeps a child approval on the child route through resolution", async () => {
    const { manager, context, emitEvent, writeMessage } = createHarness();

    request(manager, context, {
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "provider-child",
        turnId: "turn-child",
        itemId: "command-child",
        command: "bun install",
      },
    });

    const requestId = Array.from(context.pendingApprovals.keys())[0] as
      | ApprovalRequestId
      | undefined;
    expect(requestId).toBeDefined();
    await manager.respondToRequest(ThreadId.makeUnsafe("thread-1"), requestId!, "accept");

    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 42,
      result: { decision: "accept" },
    });
    expect(emitEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "request",
        providerThreadId: "provider-child",
        providerParentThreadId: "provider-parent",
      }),
    );
    expect(emitEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "notification",
        method: "item/requestApproval/decision",
        providerThreadId: "provider-child",
        providerParentThreadId: "provider-parent",
      }),
    );
  });

  it("keeps child user input on the child route through resolution", async () => {
    const { manager, context, emitEvent } = createHarness();

    request(manager, context, {
      id: 43,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "provider-child",
        turnId: "turn-child",
        itemId: "input-child",
        questions: [],
      },
    });

    const requestId = Array.from(context.pendingUserInputs.keys())[0] as
      | ApprovalRequestId
      | undefined;
    expect(requestId).toBeDefined();
    await manager.respondToUserInput(ThreadId.makeUnsafe("thread-1"), requestId!, {
      scope: "child",
    });

    expect(emitEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "request",
        providerThreadId: "provider-child",
        providerParentThreadId: "provider-parent",
      }),
    );
    expect(emitEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "notification",
        method: "item/tool/requestUserInput/answered",
        providerThreadId: "provider-child",
        providerParentThreadId: "provider-parent",
      }),
    );
  });
});
