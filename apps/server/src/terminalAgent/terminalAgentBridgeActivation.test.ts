import { describe, expect, it, vi } from "vitest";

import { gateTerminalAgentBridgeHandler } from "./terminalAgentBridgeActivation";
import { resolveTerminalAgentBridgeOperation } from "./terminalAgentBridgeOperation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("gateTerminalAgentBridgeHandler", () => {
  it("runs a pre-activation hook exactly once after launch commits", async () => {
    const activation = deferred<boolean>();
    const handler = vi.fn(async () => ({ additionalContext: "ready" }));
    const gated = gateTerminalAgentBridgeHandler(activation.promise, handler);
    const operation = resolveTerminalAgentBridgeOperation(
      gated({ runtimeInstanceId: "runtime-1", input: {} }, new AbortController().signal),
    );

    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    activation.resolve(true);

    await expect(operation.result).resolves.toEqual({
      additionalContext: "ready",
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("cancels an activation wait without executing the handler later", async () => {
    const activation = deferred<boolean>();
    const handler = vi.fn(async () => ({}));
    const gated = gateTerminalAgentBridgeHandler(activation.promise, handler);
    const operation = gated(
      { runtimeInstanceId: "runtime-1", input: {} },
      new AbortController().signal,
    );
    const resolved = resolveTerminalAgentBridgeOperation(operation);

    await resolved.cancel?.();
    await expect(resolved.result).rejects.toThrow("interrupted");
    activation.resolve(true);
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
  });

  it("forwards cancellation to the activated handler", async () => {
    const cancelled = vi.fn(async () => {});
    let started = false;
    const gated = gateTerminalAgentBridgeHandler(Promise.resolve(true), () => {
      started = true;
      return { result: new Promise(() => {}), cancel: cancelled };
    });
    const operation = resolveTerminalAgentBridgeOperation(
      gated({ runtimeInstanceId: "runtime-1", input: {} }, new AbortController().signal),
    );
    while (!started) await Promise.resolve();

    await operation.cancel?.();

    expect(cancelled).toHaveBeenCalledOnce();
  });
});
