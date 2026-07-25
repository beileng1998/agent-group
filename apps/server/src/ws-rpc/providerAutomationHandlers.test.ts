import { ThreadId, WS_METHODS, WsRpcError } from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeExecutionAdapterAuthority } from "../orchestration/Layers/ExecutionAdapterAuthority";
import {
  makeServerRuntimeStartup,
  type ServerRuntimeStartupShape,
} from "../serverRuntimeStartup";
import { toWsRpcError } from "../wsRpcError";
import { makeProviderAutomationHandlers } from "./providerAutomationHandlers";

const now = "2026-07-26T00:00:00.000Z";
const threadId = ThreadId.makeUnsafe("thread-terminal-compact");
const rpcEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  fallbackMessage: string,
) => effect.pipe(Effect.mapError((cause) => toWsRpcError(cause, fallbackMessage)));
const readyRuntimeStartup: ServerRuntimeStartupShape = {
  awaitCommandReady: Effect.void,
  markCommandReady: Effect.void,
  failCommandReady: () => Effect.void,
  enqueueCommand: (effect) => effect,
};

const makeHandlers = (
  authority: Awaited<ReturnType<typeof makeAuthority>>,
  compactThread: () => Effect.Effect<void>,
  runtimeStartup: ServerRuntimeStartupShape = readyRuntimeStartup,
  automationService: Parameters<
    typeof makeProviderAutomationHandlers
  >[0]["automationService"] = {} as never,
) =>
  makeProviderAutomationHandlers({
    automationService,
    config: {} as never,
    executionAdapterAuthority: authority,
    providerDiscoveryService: {} as never,
    providerService: { compactThread } as never,
    runtimeStartup,
    rpcEffect,
  });

const makeAuthority = () =>
  Effect.runPromise(
    makeExecutionAdapterAuthority({
      persist: () => Effect.void,
      now: () => new Date(now),
    }),
  );

describe("provider automation RPC authority", () => {
  it("rejects public compaction while terminal owns the thread", async () => {
    const authority = await makeAuthority();
    await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-terminal-compact",
        providerSessionId: null,
        startedAt: now,
      }),
    );
    const compactThread = vi.fn(() => Effect.void);
    const handlers = makeHandlers(authority, compactThread);

    const error = await Effect.runPromise(
      Effect.flip(handlers[WS_METHODS.providerCompactThread]({ threadId })),
    );

    expect(error).toBeInstanceOf(WsRpcError);
    expect(error.message).toContain("terminal execution adapter");
    expect(compactThread).not.toHaveBeenCalled();
  });

  it("does not compact before terminal recovery is ready", async () => {
    const authority = await makeAuthority();
    const runtimeStartup = await Effect.runPromise(makeServerRuntimeStartup);
    const compactThread = vi.fn(() => Effect.void);
    const handlers = makeHandlers(authority, compactThread, runtimeStartup);
    const pending = Effect.runPromise(
      handlers[WS_METHODS.providerCompactThread]({ threadId }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(compactThread).not.toHaveBeenCalled();

    await Effect.runPromise(runtimeStartup.markCommandReady);
    await pending;
    expect(compactThread).toHaveBeenCalledOnce();
  });

  it("queues automation run and cancel actions behind terminal recovery", async () => {
    const authority = await makeAuthority();
    const runtimeStartup = await Effect.runPromise(makeServerRuntimeStartup);
    let runsExecuted = 0;
    let cancelsExecuted = 0;
    const runNow = vi.fn(() =>
      Effect.sync(() => {
        runsExecuted += 1;
        return { run: {} as never };
      }),
    );
    const cancelRun = vi.fn(() =>
      Effect.sync(() => {
        cancelsExecuted += 1;
        return { run: {} as never };
      }),
    );
    const handlers = makeHandlers(
      authority,
      () => Effect.void,
      runtimeStartup,
      { runNow, cancelRun } as never,
    );
    const running = Effect.runPromise(
      handlers[WS_METHODS.automationRunNow]({
        automationId: "automation-startup" as never,
      }),
    );
    const canceling = Effect.runPromise(
      handlers[WS_METHODS.automationCancelRun]({
        runId: "automation-run-startup" as never,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runsExecuted).toBe(0);
    expect(cancelsExecuted).toBe(0);

    await Effect.runPromise(runtimeStartup.markCommandReady);
    await Promise.all([running, canceling]);
    expect(runNow).toHaveBeenCalledOnce();
    expect(cancelRun).toHaveBeenCalledOnce();
    expect(runsExecuted).toBe(1);
    expect(cancelsExecuted).toBe(1);
  });
});
