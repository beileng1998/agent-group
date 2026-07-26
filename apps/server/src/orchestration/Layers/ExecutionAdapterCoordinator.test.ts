import { TurnId } from "@agent-group/contracts";
import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import { makeExecutionAdapterAuthority } from "./ExecutionAdapterAuthority";
import { reconcileTerminalExit } from "./executionAdapterTerminalExit";
import {
  coordinatorTestSpawn as spawn,
  coordinatorTestStructuredSession as structuredSession,
  coordinatorTestThreadId as threadId,
  executionAdapterFailureReason as failureReason,
  makeExecutionAdapterCoordinatorTestHarness as makeCoordinator,
} from "./executionAdapterCoordinatorTestHarness";

const prepare = () => Effect.succeed({ providerSessionId: null, spawn });

describe("ExecutionAdapterCoordinator", () => {
  it("freezes structured admission before preparing from the final cursor", async () => {
    const latestSession = {
      ...structuredSession,
      status: "closed" as const,
      resumeCursor: { threadId: "latest-cursor" },
    };
    const { authority, coordinator } = await makeCoordinator({
      runtime: structuredSession,
      suspendedRuntime: latestSession,
    });
    let observedSession: typeof latestSession | undefined;
    let observedAuthority: unknown;

    await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-lazy-prepare",
        prepare: (session) =>
          Effect.gen(function* () {
            observedSession = session as typeof latestSession;
            observedAuthority = yield* authority.getState(threadId);
            return { providerSessionId: "latest-cursor", spawn };
          }),
      }),
    );

    expect(observedSession?.resumeCursor).toEqual({
      threadId: "latest-cursor",
    });
    expect(observedAuthority).toMatchObject({
      adapter: "terminal",
      status: "starting",
    });
  });

  it("suspends the idle structured runtime, starts one PTY, and switches back", async () => {
    const { coordinator, hostState, calls } = await makeCoordinator({
      runtime: structuredSession,
    });

    const started = await Effect.runPromise(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );
    expect(started).toMatchObject({
      revision: 1,
      runtimeInstanceId: "runtime-1",
      generation: "generation-1",
      pid: 42,
    });
    expect(calls).toEqual({ suspended: 1, resumed: 0, finalized: 1 });
    expect(await Effect.runPromise(coordinator.getState(threadId))).toMatchObject({
      adapter: "terminal",
      status: "ready",
      revision: 1,
    });

    await Effect.runPromise(coordinator.switchToStructured(threadId));
    expect(hostState.killed).toBe(true);
    expect(await Effect.runPromise(coordinator.getState(threadId))).toEqual({
      adapter: "structured",
      status: "ready",
      revision: 2,
    });
  });

  it("re-reads ownership after an in-flight switch before stopping", async () => {
    const { coordinator, hostState } = await makeCoordinator({
      runtime: structuredSession,
    });
    let releasePrepare: (() => void) | undefined;
    let markPrepareEntered: (() => void) | undefined;
    const prepareEntered = new Promise<void>((resolve) => {
      markPrepareEntered = resolve;
    });
    const prepareReleased = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    let structuredStops = 0;
    let terminalPreparations = 0;

    const switching = Effect.runFork(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-stop-race",
        prepare: () =>
          Effect.tryPromise(async () => {
            markPrepareEntered?.();
            await prepareReleased;
            return { providerSessionId: null, spawn };
          }),
      }),
    );
    await prepareEntered;

    const stopping = Effect.runFork(
      coordinator.stopCurrentAdapter({
        threadId,
        beforeTerminalStop: () =>
          Effect.sync(() => {
            terminalPreparations += 1;
          }),
        stopStructured: () =>
          Effect.sync(() => {
            structuredStops += 1;
          }),
      }),
    );
    await Promise.resolve();
    expect(hostState.killed).toBe(false);

    releasePrepare?.();
    await Effect.runPromise(Fiber.join(switching));
    const stoppedOwner = await Effect.runPromise(Fiber.join(stopping));

    expect(stoppedOwner).toBe("terminal");
    expect(terminalPreparations).toBe(1);
    expect(structuredStops).toBe(0);
    expect(hostState.killed).toBe(true);
  });

  it("blocks new structured work and drains an existing lease before stopping", async () => {
    const { authority, coordinator } = await makeCoordinator({
      runtime: structuredSession,
    });
    const claim = await Effect.runPromise(
      authority.acquireStructured(threadId, "structured:in-flight"),
    );
    let physicalStops = 0;
    const stopping = Effect.runFork(
      coordinator.stopCurrentAdapter({
        threadId,
        beforeTerminalStop: () => Effect.void,
        stopStructured: () =>
          Effect.sync(() => {
            physicalStops += 1;
          }),
      }),
    );

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = await Effect.runPromise(authority.getState(threadId));
      if (state.adapter === "structured" && state.status === "stopping") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(physicalStops).toBe(0);
    expect(
      failureReason(
        await Effect.runPromiseExit(authority.acquireStructured(threadId, "structured:late")),
      ),
    ).toBe("transition-in-progress");

    await Effect.runPromise(claim.release);
    await expect(Effect.runPromise(Fiber.join(stopping))).resolves.toBe("structured");
    expect(physicalStops).toBe(1);
    expect(await Effect.runPromise(authority.getState(threadId))).toMatchObject({
      adapter: "structured",
      status: "ready",
    });
  });

  it("restores structured admission when the physical stop fails", async () => {
    const { authority, coordinator } = await makeCoordinator({
      runtime: structuredSession,
    });
    const failed = await Effect.runPromiseExit(
      coordinator.stopCurrentAdapter({
        threadId,
        beforeTerminalStop: () => Effect.void,
        stopStructured: () => Effect.fail(new Error("stop failed")),
      }),
    );

    expect(failureReason(failed)).toBe("structured-runtime");
    expect(await Effect.runPromise(authority.getState(threadId))).toMatchObject({
      adapter: "structured",
      status: "ready",
    });
    const claim = await Effect.runPromise(
      authority.acquireStructured(threadId, "structured:after-failure"),
    );
    await Effect.runPromise(claim.release);
  });

  it("rejects a live structured turn without opening a terminal authority window", async () => {
    const { coordinator, hostState } = await makeCoordinator({
      runtime: {
        ...structuredSession,
        status: "running",
        activeTurnId: TurnId.makeUnsafe("turn-1"),
      },
    });

    const failed = await Effect.runPromiseExit(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );
    expect(failureReason(failed)).toBe("turn-in-flight");
    expect(hostState.alive).toBe(false);
    expect(await Effect.runPromise(coordinator.getState(threadId))).toEqual({
      adapter: "structured",
      status: "ready",
      revision: 0,
    });
  });

  it("keeps structured events admitted while a live-runtime check is pending", async () => {
    let enterLookup: (() => void) | undefined;
    let releaseLookup: (() => void) | undefined;
    const lookupEntered = new Promise<void>((resolve) => {
      enterLookup = resolve;
    });
    const lookupReleased = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    const { authority, coordinator, hostState } = await makeCoordinator({
      findStructuredRuntime: () =>
        Effect.tryPromise(async () => {
          enterLookup?.();
          await lookupReleased;
          return {
            ...structuredSession,
            status: "running" as const,
            activeTurnId: TurnId.makeUnsafe("turn-raced"),
          };
        }),
    });
    const switching = Effect.runFork(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-race",
        prepare,
      }),
    );
    await lookupEntered;

    expect(await Effect.runPromise(authority.getState(threadId))).toEqual({
      adapter: "structured",
      status: "ready",
      revision: 0,
    });
    const eventClaim = await Effect.runPromise(
      authority.acquireStructured(threadId, "structured:event-during-check"),
    );
    await Effect.runPromise(eventClaim.release);

    releaseLookup?.();
    expect(failureReason(await Effect.runPromiseExit(Fiber.join(switching)))).toBe(
      "turn-in-flight",
    );
    expect(hostState.alive).toBe(false);
    expect(await Effect.runPromise(authority.getState(threadId))).toMatchObject({
      adapter: "structured",
      revision: 0,
    });
  });

  it("resumes the structured runtime when PTY start fails", async () => {
    const { coordinator, calls } = await makeCoordinator({
      runtime: structuredSession,
      spawnFails: true,
    });

    const failed = await Effect.runPromiseExit(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );
    expect(failureReason(failed)).toBe("host");
    expect(calls).toEqual({ suspended: 1, resumed: 1, finalized: 0 });
    expect(await Effect.runPromise(coordinator.getState(threadId))).toMatchObject({
      adapter: "structured",
      status: "ready",
    });
  });

  it("tears down an unidentifiable PTY before restoring structured authority", async () => {
    const { coordinator, hostState, calls } = await makeCoordinator({
      runtime: structuredSession,
      identityCaptureFails: true,
    });

    const failed = await Effect.runPromiseExit(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );

    expect(failureReason(failed)).toBe("host");
    expect(hostState.killed).toBe(true);
    expect(calls).toEqual({ suspended: 1, resumed: 1, finalized: 0 });
    expect(await Effect.runPromise(coordinator.getState(threadId))).toMatchObject({
      adapter: "structured",
      status: "ready",
    });
  });

  it("durably retains the spawned PID when identity capture and teardown fail", async () => {
    const { coordinator, authority, hostState } = await makeCoordinator({
      runtime: structuredSession,
      identityCaptureFails: true,
      killFails: true,
    });

    const failed = await Effect.runPromiseExit(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );

    expect(failureReason(failed)).toBe("compensation-failed");
    expect(hostState.alive).toBe(true);
    expect(await Effect.runPromise(authority.getState(threadId))).toMatchObject({
      adapter: "terminal",
      status: "starting",
      pid: 42,
      ownerIdentity: null,
    });
  });

  it("reopens structured admission when compensation cannot resume the old runtime", async () => {
    const { coordinator } = await makeCoordinator({
      runtime: structuredSession,
      spawnFails: true,
      resumeFails: true,
    });

    const failed = await Effect.runPromiseExit(
      coordinator.switchToTerminal({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        prepare,
      }),
    );
    expect(failureReason(failed)).toBe("compensation-failed");
    expect(await Effect.runPromise(coordinator.getState(threadId))).toMatchObject({
      adapter: "structured",
      status: "ready",
    });
  });

  it("keeps natural exits terminal-owned and records the exit", async () => {
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
      coordinator.updateTerminalState({
        threadId,
        revision: started.revision,
        generation: started.generation,
        patch: { status: "running", activeTurnId: "turn-active" },
      }),
    );

    hostState.exitListener?.({ generation: "generation-1", exitCode: 9, signal: 15 });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = await Effect.runPromise(coordinator.getState(threadId));
      if (state.adapter === "terminal" && state.status === "exited") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(await Effect.runPromise(coordinator.getState(threadId))).toMatchObject({
      adapter: "terminal",
      status: "exited",
      activeTurnId: "turn-active",
      exitCode: 9,
      exitSignal: 15,
    });
  });

  it("retries a transient durable write while recording terminal exit", async () => {
    let persistenceAttempts = 0;
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        persist: () =>
          Effect.suspend(() => {
            persistenceAttempts += 1;
            return persistenceAttempts === 3
              ? Effect.fail(new Error("transient disk failure"))
              : Effect.void;
          }),
        now: () => new Date("2026-07-25T00:00:00.000Z"),
      }),
    );
    const starting = await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-1",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    await Effect.runPromise(
      authority.completeTerminalStart({
        threadId,
        revision: starting.revision,
        generation: "generation-1",
        pid: 42,
        ownerIdentity: {
          pid: 42,
          startTime: "2026-07-25T00:00:00.000Z",
          commandFingerprint: "0".repeat(64),
        },
        processGroupIdentity: null,
      }),
    );

    await Effect.runPromise(
      reconcileTerminalExit({
        authority,
        threadId,
        revision: starting.revision,
        generation: "generation-1",
        exitCode: 1,
        signal: undefined,
      }),
    );

    expect(persistenceAttempts).toBe(4);
    expect(await Effect.runPromise(authority.getState(threadId))).toMatchObject({
      status: "exited",
      exitCode: 1,
    });
  });
});
