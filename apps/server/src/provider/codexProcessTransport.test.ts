import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { ThreadId } from "@agent-group/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "./codexManagerProtocol.ts";
import { CodexProcessTransport } from "./codexProcessTransport.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";

function createHarness() {
  const child = new EventEmitter();
  const stderr = new PassThrough();
  Object.assign(child, {
    stderr,
    stdin: new PassThrough(),
  });

  const publishEvent = vi.fn();
  const updateSession = vi.fn();
  const transport = new CodexProcessTransport({
    sessions: new Map(),
    discoverySessions: new Map(),
    updateSession,
    handleServerRequest: vi.fn(),
    handleServerNotification: vi.fn(),
    publishEvent,
  });
  const context = {
    session: {
      provider: "codex",
      status: "running",
      threadId: ThreadId.makeUnsafe("thread-1"),
      runtimeMode: "full-access",
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    },
    account: {
      type: "unknown",
      planType: null,
      sparkEnabled: true,
    },
    child,
    output: new EventEmitter(),
    pending: new Map(),
    pendingApprovals: new Map(),
    pendingUserInputs: new Map(),
    collabReceiverTurns: new Map(),
    collabReceiverParents: new Map(),
    reviewTurnIds: new Set(),
    nextRequestId: 1,
    stopping: false,
  } as unknown as CodexSessionContext;

  return { child, context, publishEvent, stderr, transport, updateSession };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CodexProcessTransport stderr", () => {
  it("buffers split JSON diagnostics and keeps them out of provider events", async () => {
    const { context, publishEvent, stderr, transport } = createHarness();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const line = JSON.stringify({
      timestamp: "2026-07-21T01:02:03.000Z",
      level: "WARN",
      fields: {
        message: "failed to load recommended plugins",
        error: "request timed out",
      },
      target: "codex_core::plugins",
    });

    transport.attachProcessListeners(context);
    stderr.write(line.slice(0, 37));
    stderr.write(`${line.slice(37)}\n`);
    stderr.write(
      `${JSON.stringify({ level: "INFO", fields: { message: "catalog loaded" } })}\n`,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("codex app-server diagnostic", {
      threadId: ThreadId.makeUnsafe("thread-1"),
      message: "failed to load recommended plugins: request timed out",
      target: "codex_core::plugins",
    });
    expect(publishEvent).not.toHaveBeenCalled();
    stderr.end();
  });

  it("still publishes process failures", () => {
    const { child, context, publishEvent, stderr, transport, updateSession } = createHarness();
    transport.attachProcessListeners(context);

    child.emit("error", new Error("spawn failed"));

    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "error",
      lastError: "spawn failed",
    });
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "error",
        method: "process/error",
        message: "spawn failed",
      }),
    );
    stderr.end();
  });
});
