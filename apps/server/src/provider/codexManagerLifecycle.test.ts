import { describe, expect, it, vi } from "vitest";

import {
  CodexManagerClosedError,
  CodexManagerLifecycleCoordinator,
  CodexManagerLifecycleSupersededError,
} from "./codexManagerLifecycle.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("CodexManagerLifecycleCoordinator", () => {
  it("serializes creation and mutation for the same owner", async () => {
    const coordinator = new CodexManagerLifecycleCoordinator();
    const gate = deferred();
    const order: string[] = [];
    const creation = coordinator.runCreation("session:one", async () => {
      order.push("create:start");
      await gate.promise;
      order.push("create:end");
    });
    const mutation = coordinator.runMutation("session:one", async () => {
      order.push("stop");
    });

    await vi.waitFor(() => expect(order).toEqual(["create:start"]));
    gate.resolve();
    await Promise.all([creation, mutation]);
    expect(order).toEqual(["create:start", "create:end", "stop"]);
  });

  it("starts stopping immediately and supersedes a paused creation before returning", async () => {
    const coordinator = new CodexManagerLifecycleCoordinator();
    const gate = deferred();
    const stopped = vi.fn();
    const creation = coordinator.runCreation("session:one", async (lease) => {
      await gate.promise;
      lease.assertCurrent();
    });
    const stopAll = coordinator.runStopAll(async () => stopped());

    await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(1));
    gate.resolve();
    await expect(creation).rejects.toBeInstanceOf(CodexManagerLifecycleSupersededError);
    await stopAll;
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it("drains queued same-owner creation without deadlocking stopAll", async () => {
    const coordinator = new CodexManagerLifecycleCoordinator();
    const gate = deferred();
    const first = coordinator.runCreation("session:one", async (lease) => {
      await gate.promise;
      lease.assertCurrent();
    });
    const queued = coordinator.runCreation("session:one", async () => undefined);
    const stopAll = coordinator.runStopAll(async () => undefined);

    gate.resolve();
    await expect(first).rejects.toBeInstanceOf(CodexManagerLifecycleSupersededError);
    await expect(queued).rejects.toBeInstanceOf(CodexManagerLifecycleSupersededError);
    await stopAll;
  });

  it("holds new creation behind stopAll and permits it after the barrier", async () => {
    const coordinator = new CodexManagerLifecycleCoordinator();
    const gate = deferred();
    const order: string[] = [];
    const stopAll = coordinator.runStopAll(async () => {
      order.push("stop:start");
      await gate.promise;
      order.push("stop:end");
    });
    const creation = coordinator.runCreation("session:one", async () => {
      order.push("create");
    });

    await Promise.resolve();
    expect(order).toEqual(["stop:start"]);
    gate.resolve();
    await Promise.all([stopAll, creation]);
    expect(order).toEqual(["stop:start", "stop:end", "create"]);
  });

  it("coalesces concurrent stopAll calls", async () => {
    const coordinator = new CodexManagerLifecycleCoordinator();
    const gate = deferred();
    const operation = vi.fn(async () => gate.promise);
    const first = coordinator.runStopAll(operation);
    const second = coordinator.runStopAll(operation);

    expect(operation).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([first, second]);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("permanently rejects creation after close", async () => {
    const coordinator = new CodexManagerLifecycleCoordinator();
    await coordinator.runClose(async () => undefined);

    await expect(
      coordinator.runCreation("session:one", async () => undefined),
    ).rejects.toBeInstanceOf(CodexManagerClosedError);
    await coordinator.runClose(async () => {
      throw new Error("close should be coalesced");
    });
  });

  it("closes permanently while an existing creation is still draining", async () => {
    const coordinator = new CodexManagerLifecycleCoordinator();
    const gate = deferred();
    const creation = coordinator.runCreation("session:one", async (lease) => {
      await gate.promise;
      lease.assertCurrent();
    });
    const close = coordinator.runClose(async () => undefined);

    await expect(
      coordinator.runCreation("session:two", async () => undefined),
    ).rejects.toBeInstanceOf(CodexManagerClosedError);
    gate.resolve();
    await expect(creation).rejects.toBeInstanceOf(CodexManagerLifecycleSupersededError);
    await close;
  });

  it("keeps creation closed while allowing failed cleanup proof to retry", async () => {
    const coordinator = new CodexManagerLifecycleCoordinator();
    const firstCleanup = coordinator.runClose(async () => {
      throw new Error("inspection unavailable");
    });

    await expect(firstCleanup).rejects.toThrow("inspection unavailable");
    await expect(
      coordinator.runCreation("session:one", async () => undefined),
    ).rejects.toBeInstanceOf(CodexManagerClosedError);

    const retryCleanup = vi.fn(async () => undefined);
    await coordinator.runClose(retryCleanup);
    expect(retryCleanup).toHaveBeenCalledTimes(1);
  });
});
