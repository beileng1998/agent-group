import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import {
  coordinatorTestSpawn as spawn,
  coordinatorTestStructuredSession as structuredSession,
  coordinatorTestThreadId as threadId,
  executionAdapterFailureReason as failureReason,
  makeExecutionAdapterCoordinatorTestHarness as makeCoordinator,
} from "./executionAdapterCoordinatorTestHarness";

const prepare = () => Effect.succeed({ providerSessionId: null, spawn });

describe("ExecutionAdapterCoordinator terminal lifecycle", () => {
  it("aborts a failed initial launch back to structured authority", async () => {
    const { authority, coordinator, hostState } = await makeCoordinator();
    const started = await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-abort",
        prepare,
      }),
    );

    await Effect.runPromise(
      coordinator.abortTerminalLaunch({
        threadId,
        revision: started.revision,
        generation: started.generation,
        restoreStructured: true,
      }),
    );

    expect(hostState.killed).toBe(true);
    expect(await Effect.runPromise(authority.getState(threadId))).toMatchObject({
      adapter: "structured",
      status: "ready",
    });
  });

  it("keeps failed restart compensation terminal-owned and stopped", async () => {
    const { authority, coordinator } = await makeCoordinator();
    const started = await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-restart-abort",
        prepare,
      }),
    );

    await Effect.runPromise(
      coordinator.abortTerminalLaunch({
        threadId,
        revision: started.revision,
        generation: started.generation,
        restoreStructured: false,
      }),
    );

    expect(await Effect.runPromise(authority.getState(threadId))).toMatchObject({
      adapter: "terminal",
      status: "stopped",
      pid: null,
    });
    expect(
      failureReason(
        await Effect.runPromiseExit(
          authority.acquireStructured(threadId, "after-restart-abort"),
        ),
      ),
    ).toBe("not-structured");
  });

  it("restarts a terminal-owned thread after the previous host has exited", async () => {
    const { coordinator, hostState } = await makeCoordinator();
    const first = await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );
    hostState.alive = false;
    hostState.exitListener?.({ generation: first.generation, exitCode: 0 });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = await Effect.runPromise(coordinator.getState(threadId));
      if (state.adapter === "terminal" && state.status === "exited") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const restarted = await Effect.runPromise(
      coordinator.restartTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-2",
        spawn,
      }),
    );

    expect(restarted.revision).toBe(first.revision + 1);
    expect(hostState.killed).toBe(true);
    expect(await Effect.runPromise(coordinator.getState(threadId))).toMatchObject({
      adapter: "terminal",
      revision: restarted.revision,
      runtimeInstanceId: "runtime-2",
      status: "ready",
    });
  });

  it("kills an owned host even when startup never persisted a generation", async () => {
    const { authority, coordinator, hostState } = await makeCoordinator();
    await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-starting",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    hostState.alive = true;

    await Effect.runPromise(coordinator.stopTerminal(threadId));

    expect(hostState.killed).toBe(true);
    expect(await Effect.runPromise(coordinator.getState(threadId))).toMatchObject({
      adapter: "terminal",
      status: "stopped",
      generation: null,
    });
  });

  it("fences terminal I/O with both authority revision and host generation", async () => {
    const { coordinator, hostState } = await makeCoordinator();
    const started = await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );

    await Effect.runPromise(
      coordinator.write({
        threadId,
        revision: started.revision,
        generation: started.generation,
        data: "hello",
      }),
    );
    expect(hostState.writes).toEqual(["hello"]);
    const staleRevision = await Effect.runPromiseExit(
      coordinator.write({
        threadId,
        revision: started.revision - 1,
        generation: started.generation,
        data: "stale",
      }),
    );
    const staleGeneration = await Effect.runPromiseExit(
      coordinator.resize({
        threadId,
        revision: started.revision,
        generation: "old-generation",
        cols: 100,
        rows: 30,
      }),
    );
    expect(failureReason(staleRevision)).toBe("stale-revision");
    expect(failureReason(staleGeneration)).toBe("stale-generation");
  });

  it("holds a terminal lease until a physical write settles", async () => {
    const { coordinator, hostState } = await makeCoordinator();
    const started = await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-write-race",
        prepare,
      }),
    );
    let releaseWrite: (() => void) | undefined;
    let markWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    hostState.writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    hostState.onWriteStarted = () => markWriteStarted?.();
    const writing = Effect.runFork(
      coordinator.write({
        threadId,
        revision: started.revision,
        generation: started.generation,
        data: "before-stop",
      }),
    );
    await writeStarted;

    expect(
      failureReason(await Effect.runPromiseExit(coordinator.stopTerminal(threadId))),
    ).toBe("turn-in-flight");
    releaseWrite?.();
    await Effect.runPromise(Fiber.join(writing));
    await expect(Effect.runPromise(coordinator.stopTerminal(threadId))).resolves.toBeUndefined();
    expect(hostState.writes).toEqual(["before-stop"]);
  });

  it("holds an epoch lease through terminal work and blocks adapter transitions", async () => {
    const { coordinator } = await makeCoordinator();
    const started = await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );
    const claim = await Effect.runPromise(
      coordinator.acquireTerminalOperation({
        threadId,
        revision: started.revision,
        generation: started.generation,
        claimId: "hook:event-1",
      }),
    );

    expect(
      failureReason(
        await Effect.runPromiseExit(coordinator.switchToStructured(threadId)),
      ),
    ).toBe("turn-in-flight");
    await Effect.runPromise(claim.release);
    await expect(
      Effect.runPromise(coordinator.switchToStructured(threadId)),
    ).resolves.toBeUndefined();
  });

  it("keeps the old runtime fence manageable when restart teardown fails", async () => {
    const { coordinator, hostState } = await makeCoordinator();
    const started = await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );
    hostState.killFails = true;

    expect(
      failureReason(
        await Effect.runPromiseExit(
          coordinator.restartTerminal({
            threadId,
            provider: "codex",
            runtimeInstanceId: "runtime-2",
            spawn,
          }),
        ),
      ),
    ).toBe("host");
    expect(await Effect.runPromise(coordinator.getState(threadId))).toMatchObject({
      adapter: "terminal",
      revision: started.revision,
      runtimeInstanceId: "runtime-1",
      generation: started.generation,
      status: "error",
    });
    await expect(
      Effect.runPromise(
        coordinator.write({
          threadId,
          revision: started.revision,
          generation: started.generation,
          data: "still-managed",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("propagates teardown failure and retains terminal authority for retry", async () => {
    const { coordinator, hostState } = await makeCoordinator();
    await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );
    hostState.killFails = true;

    const failed = await Effect.runPromiseExit(coordinator.teardownThread(threadId));
    expect(failureReason(failed)).toBe("host");
    expect(await Effect.runPromise(coordinator.getState(threadId))).toMatchObject({
      adapter: "terminal",
      status: "deleting",
    });
  });

  it("tombstones deletion before draining structured work and keeps admission closed", async () => {
    const { authority, coordinator } = await makeCoordinator({
      runtime: structuredSession,
    });
    const claim = await Effect.runPromise(
      authority.acquireStructured(threadId, "structured:delete-in-flight"),
    );
    const teardown = Effect.runFork(coordinator.teardownThread(threadId));

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = await Effect.runPromise(authority.getState(threadId));
      if (state.adapter === "structured" && state.status === "deleting") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(
      failureReason(
        await Effect.runPromiseExit(
          authority.acquireStructured(threadId, "structured:delete-late"),
        ),
      ),
    ).toBe("transition-in-progress");
    await Effect.runPromise(claim.release);
    await Effect.runPromise(Fiber.join(teardown));
    expect(await Effect.runPromise(authority.getState(threadId))).toMatchObject({
      adapter: "structured",
      status: "deleting",
    });
  });

  it("keeps a durable tombstone through cleanup, then forgets the deleted thread", async () => {
    const { authority, coordinator } = await makeCoordinator();
    await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );
    await Effect.runPromise(coordinator.switchToStructured(threadId));
    expect((await Effect.runPromise(authority.listStates)).has(threadId)).toBe(true);

    await Effect.runPromise(coordinator.teardownThread(threadId));

    expect(await Effect.runPromise(coordinator.getState(threadId))).toMatchObject({
      adapter: "structured",
      status: "deleting",
    });
    expect((await Effect.runPromise(authority.listStates)).has(threadId)).toBe(true);
    await Effect.runPromise(coordinator.finalizeThreadDeletion(threadId));
    expect((await Effect.runPromise(authority.listStates)).has(threadId)).toBe(false);
  });
});
