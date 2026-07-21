import { EventEmitter } from "node:events";

import { ThreadId, type ProviderSession } from "@agent-group/contracts";
import { describe, expect, it, vi } from "vitest";

import { CodexAppServerManager } from "./codexAppServerManager.ts";
import {
  ProviderProcessExitUnprovenError,
  type teardownProviderProcessTree,
} from "./provider/supervisedProcessTeardown.ts";

class FakeCodexChild extends EventEmitter {
  readonly pid = 5_151;
  readonly stdin = { writable: true, write: vi.fn() };
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
}

function installSession(manager: CodexAppServerManager, child: FakeCodexChild) {
  const threadId = ThreadId.makeUnsafe("thread-codex-exit-proof");
  const session: ProviderSession = {
    provider: "codex",
    status: "ready",
    threadId,
    runtimeMode: "full-access",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
  const output = { close: vi.fn() };
  const context = {
    session,
    account: { type: "unknown", planType: null, sparkEnabled: true },
    child,
    output,
    pending: new Map(),
    pendingApprovals: new Map(),
    pendingUserInputs: new Map(),
    collabReceiverTurns: new Map(),
    collabReceiverParents: new Map(),
    reviewTurnIds: new Set(),
    nextRequestId: 1,
    stopping: false,
  };
  (manager as unknown as { sessions: Map<ThreadId, unknown> }).sessions.set(threadId, context);
  return { threadId, output, context };
}

describe("CodexAppServerManager process teardown", () => {
  it("keeps one stop in flight and closes only after process exit proof", async () => {
    const teardownProcessTree: typeof teardownProviderProcessTree = vi.fn(async (input) => {
      expect(input.rootPid).toBe(5_151);
      await input.rootExited;
      return { escalated: false, signalErrors: [] };
    });
    const manager = new CodexAppServerManager(undefined, { teardownProcessTree });
    const child = new FakeCodexChild();
    const { threadId, output } = installSession(manager, child);
    const closedEvents: string[] = [];
    manager.on("event", (event) => {
      if (event.method === "session/closed") closedEvents.push(event.method);
    });

    const firstStop = manager.stopSession(threadId);
    const concurrentStop = manager.stopSession(threadId);

    await vi.waitFor(() => expect(teardownProcessTree).toHaveBeenCalledTimes(1));
    expect(manager.hasSession(threadId)).toBe(false);
    expect(manager.listSessions()).toHaveLength(1);
    expect(closedEvents).toEqual([]);
    expect(() =>
      (manager as unknown as { requireSession(id: ThreadId): unknown }).requireSession(threadId),
    ).toThrow(`Unknown session for thread: ${threadId}`);

    child.exitCode = 0;
    child.emit("exit", 0, null);
    await Promise.all([firstStop, concurrentStop]);

    expect(output.close).toHaveBeenCalledTimes(1);
    expect(closedEvents).toEqual(["session/closed"]);
    expect(manager.hasSession(threadId)).toBe(false);
  });

  it("rejects new JSON-RPC requests while teardown is in flight", async () => {
    const teardownProcessTree: typeof teardownProviderProcessTree = vi.fn(async (input) => {
      await input.rootExited;
      return { escalated: false, signalErrors: [] };
    });
    const manager = new CodexAppServerManager(undefined, { teardownProcessTree });
    const child = new FakeCodexChild();
    const { threadId, context } = installSession(manager, child);

    const stopping = manager.stopSession(threadId);
    await vi.waitFor(() => expect(context.stopping).toBe(true));
    await expect(
      (
        manager as unknown as {
          sendRequest: (context: unknown, method: string, params: unknown) => Promise<unknown>;
        }
      ).sendRequest(context, "model/list", {}),
    ).rejects.toThrow("session is stopping");
    expect(context.pending.size).toBe(0);
    expect(child.stdin.write).not.toHaveBeenCalled();

    child.exitCode = 0;
    child.emit("exit", 0, null);
    await stopping;
  });

  it("removes a pending request immediately when stdin cannot be written", async () => {
    const manager = new CodexAppServerManager();
    const child = new FakeCodexChild();
    child.stdin.writable = false;
    const { context } = installSession(manager, child);

    await expect(
      (
        manager as unknown as {
          sendRequest: (context: unknown, method: string, params: unknown) => Promise<unknown>;
        }
      ).sendRequest(context, "model/list", {}),
    ).rejects.toThrow("Cannot write to codex app-server stdin");
    expect(context.pending.size).toBe(0);
  });

  it("fails closed when process-tree exit cannot be proven", async () => {
    const teardownProcessTree: typeof teardownProviderProcessTree = vi.fn(async () => {
      throw new Error("process still alive");
    });
    const manager = new CodexAppServerManager(undefined, { teardownProcessTree });
    const { threadId } = installSession(manager, new FakeCodexChild());

    await expect(manager.stopSession(threadId)).rejects.toThrow(
      "Failed to prove Codex app-server process-tree exit",
    );
    await expect(manager.stopSession(threadId)).rejects.toThrow("process still alive");

    expect(teardownProcessTree).toHaveBeenCalledTimes(1);
    expect(manager.hasSession(threadId)).toBe(false);
    expect(manager.listSessions()[0]).toMatchObject({ status: "ready" });
  });

  it("allows a safe retry when capture failed before any signal was sent", async () => {
    let attempts = 0;
    const teardownProcessTree: typeof teardownProviderProcessTree = vi.fn(async (input) => {
      attempts += 1;
      if (attempts === 1) {
        throw new ProviderProcessExitUnprovenError({
          rootPid: input.rootPid,
          rootExited: false,
          remainingDescendantPids: [],
          captureComplete: false,
          safeToRetry: true,
        });
      }
      await input.rootExited;
      return { escalated: false, signalErrors: [] };
    });
    const manager = new CodexAppServerManager(undefined, { teardownProcessTree });
    const child = new FakeCodexChild();
    const { threadId } = installSession(manager, child);

    await expect(manager.stopSession(threadId)).rejects.toThrow("did not prove exit");
    const retried = manager.stopSession(threadId);
    await vi.waitFor(() => expect(teardownProcessTree).toHaveBeenCalledTimes(2));
    child.exitCode = 0;
    child.emit("exit", 0, null);
    await retried;

    expect(manager.listSessions()).toEqual([]);
  });

  it("reuses a post-signal proof retry without recapturing through the manager", async () => {
    const retry = vi.fn(async () => ({ escalated: true, signalErrors: [] }));
    const teardownProcessTree: typeof teardownProviderProcessTree = vi.fn(async (input) => {
      throw new ProviderProcessExitUnprovenError({
        rootPid: input.rootPid,
        rootExited: true,
        remainingDescendantPids: null,
        captureComplete: true,
        safeToRetry: true,
        retry,
      });
    });
    const manager = new CodexAppServerManager(undefined, { teardownProcessTree });
    const { threadId } = installSession(manager, new FakeCodexChild());

    await expect(manager.stopSession(threadId)).rejects.toThrow("did not prove exit");
    await manager.stopSession(threadId);

    expect(teardownProcessTree).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(manager.listSessions()).toEqual([]);
  });

  it("drains and supersedes an in-flight creation before stopAll returns", async () => {
    let releaseCreation!: () => void;
    const creationGate = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });
    const manager = new CodexAppServerManager();
    const internals = manager as unknown as {
      startSessionInternal: (
        input: { threadId: ThreadId },
        lease: { assertCurrent(): void },
      ) => Promise<ProviderSession>;
      stopAllContexts: () => Promise<void>;
    };
    const startInternal = vi
      .spyOn(internals, "startSessionInternal")
      .mockImplementation(async (input, lease) => {
        await creationGate;
        lease.assertCurrent();
        return {
          provider: "codex",
          status: "ready",
          threadId: input.threadId,
          runtimeMode: "full-access",
          createdAt: "2026-07-19T00:00:00.000Z",
          updatedAt: "2026-07-19T00:00:00.000Z",
        };
      });
    const stopAllContexts = vi.spyOn(internals, "stopAllContexts").mockResolvedValue();
    const threadId = ThreadId.makeUnsafe("thread-creation-stop-all");
    const starting = manager.startSession({ threadId, runtimeMode: "full-access" });
    await vi.waitFor(() => expect(startInternal).toHaveBeenCalledTimes(1));

    const stopping = manager.stopAll();
    await vi.waitFor(() => expect(stopAllContexts).toHaveBeenCalledTimes(1));
    releaseCreation();
    await expect(starting).rejects.toThrow("lifecycle changed");
    await stopping;

    expect(stopAllContexts).toHaveBeenCalledTimes(1);
  });

  it("permanently rejects provider creation after manager close", async () => {
    const manager = new CodexAppServerManager();
    await manager.close();

    await expect(
      manager.startSession({
        threadId: ThreadId.makeUnsafe("thread-after-manager-close"),
        runtimeMode: "full-access",
      }),
    ).rejects.toThrow("manager is closed");
  });
});
