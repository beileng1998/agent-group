import {
  DEFAULT_SERVER_SETTINGS,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@agent-group/contracts";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import type { TerminalAuthorityState } from "../orchestration/Services/ExecutionAdapterAuthority";
import type {
  ExecutionAdapterCoordinatorShape,
  ExecutionAdapterState,
} from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type { ProviderRuntimeIngestionShape } from "../orchestration/Services/ProviderRuntimeIngestion";
import { TerminalAgentServiceError } from "./Services/TerminalAgentService";
import { recoverTerminalRuntime } from "./terminalAgentRecovery";
import type { ResolvedTerminalTarget } from "./terminalAgentRuntimeTypes";

const threadId = ThreadId.makeUnsafe("terminal-recovery-thread");
const settings = {
  ...DEFAULT_SERVER_SETTINGS,
  enableManagedAgentTerminal: true,
};
const target = {
  threadId,
  provider: "codex",
  modelSelection: { provider: "codex", model: "gpt-5" },
  runtimeMode: "full-access",
  workspaceRoot: "/workspace",
  coordinates: {
    workspaceRoot: "/workspace",
    groupId: "group-1",
    sessionId: threadId,
    createdAt: "2026-07-25T00:00:00.000Z",
  },
} as ResolvedTerminalTarget;

function terminalState(patch: Partial<TerminalAuthorityState> = {}): TerminalAuthorityState {
  return {
    adapter: "terminal",
    revision: 7,
    provider: "codex",
    status: "exited",
    runtimeInstanceId: "runtime-1",
    generation: "generation-1",
    pid: 42,
    ownerIdentity: {
      pid: 42,
      startTime: "Sat Jul 25 00:00:00 2026",
      commandFingerprint: "0".repeat(64),
    },
    processGroupIdentity: null,
    providerSessionId: "session-1",
    activeTurnId: null,
    startedAt: "2026-07-25T00:00:00.000Z",
    exitCode: 0,
    exitSignal: null,
    error: null,
    ...patch,
  };
}

function makeHarness(initial: TerminalAuthorityState) {
  let state: ExecutionAdapterState = initial;
  let switches = 0;
  let teardowns = 0;
  let ownerChecks = 0;
  let retiredRuntimes = 0;
  const events: ProviderRuntimeEvent[] = [];
  const coordinator = {
    getState: () => Effect.sync(() => state),
    streamChanges: Stream.empty,
    switchToStructured: () =>
      Effect.sync(() => {
        switches += 1;
        state = {
          adapter: "structured",
          revision: state.revision + 1,
          status: "ready",
        };
      }),
    teardownThread: () =>
      Effect.sync(() => {
        teardowns += 1;
        state = {
          adapter: "structured",
          revision: state.revision + 1,
          status: "deleting",
        };
      }),
    updateTerminalState: (input: { patch: Partial<TerminalAuthorityState> }) =>
      Effect.sync(() => {
        if (state.adapter !== "terminal") throw new Error("not terminal");
        state = { ...state, ...input.patch };
        return state;
      }),
  } as unknown as ExecutionAdapterCoordinatorShape;
  const ingestion = {
    start: Effect.void,
    drain: Effect.void,
    publishTerminal: (event: ProviderRuntimeEvent) =>
      Effect.sync(() => {
        events.push(event);
      }),
  } satisfies ProviderRuntimeIngestionShape;
  const engine = {
    getReadModel: () =>
      Effect.succeed({
        threads: [{ id: threadId, messages: [] }],
      }),
  } as unknown as OrchestrationEngineShape;
  return {
    coordinator,
    ingestion,
    engine,
    ensurePreviousOwnerExited: () =>
      Effect.sync(() => {
        ownerChecks += 1;
      }),
    retirePreviousRuntime: () =>
      Effect.sync(() => {
        retiredRuntimes += 1;
      }),
    events,
    getState: () => state,
    switches: () => switches,
    teardowns: () => teardowns,
    ownerChecks: () => ownerChecks,
    retiredRuntimes: () => retiredRuntimes,
  };
}

const resolutionFailure = () =>
  Effect.fail(
    new TerminalAgentServiceError({
      reason: "thread-not-found",
      message: "Thread disappeared.",
    }),
  );

describe("managed terminal recovery", () => {
  it("does not auto-restart a terminal that the user explicitly stopped", async () => {
    const harness = makeHarness(terminalState({ status: "stopped" }));
    let resolutions = 0;
    let launches = 0;

    await Effect.runPromise(
      recoverTerminalRuntime({
        threadId,
        state: terminalState({ status: "stopped" }),
        settings,
        ...harness,
        resolveTarget: () => {
          resolutions += 1;
          return Effect.succeed(target);
        },
        launch: () => {
          launches += 1;
          return Effect.succeed(undefined);
        },
      }),
    );

    expect(resolutions).toBe(1);
    expect(launches).toBe(0);
    expect(harness.ownerChecks()).toBe(0);
    expect(harness.retiredRuntimes()).toBe(1);
    expect(harness.getState()).toMatchObject({
      adapter: "terminal",
      status: "stopped",
    });
  });

  it("preserves a terminal deletion tombstone for the startup cleanup sweep", async () => {
    const deleting = terminalState({ status: "deleting" });
    const harness = makeHarness(deleting);
    let resolutions = 0;

    await Effect.runPromise(
      recoverTerminalRuntime({
        threadId,
        state: deleting,
        settings,
        ...harness,
        resolveTarget: () => {
          resolutions += 1;
          return Effect.succeed(target);
        },
        launch: () => Effect.succeed(undefined),
      }),
    );

    expect(resolutions).toBe(0);
    expect(harness.ownerChecks()).toBe(1);
    expect(harness.switches()).toBe(0);
    expect(harness.teardowns()).toBe(0);
    expect(harness.retiredRuntimes()).toBe(1);
    expect(harness.getState()).toEqual(deleting);
  });

  it("releases a stopped terminal when its provider is disabled", async () => {
    const stopped = terminalState({ status: "stopped" });
    const harness = makeHarness(stopped);

    await Effect.runPromise(
      recoverTerminalRuntime({
        threadId,
        state: stopped,
        settings: {
          ...settings,
          providers: {
            ...settings.providers,
            codex: { ...settings.providers.codex, enabled: false },
          },
        },
        ...harness,
        resolveTarget: () => Effect.succeed(target),
        launch: () => Effect.succeed(undefined),
      }),
    );

    expect(harness.switches()).toBe(1);
    expect(harness.getState()).toMatchObject({ adapter: "structured" });
  });

  it("keeps abnormal stopped authority while its recorded owner is alive", async () => {
    const stopped = terminalState({ status: "stopped", pid: 4242 });
    const harness = makeHarness(stopped);

    await expect(
      Effect.runPromise(
        recoverTerminalRuntime({
          threadId,
          state: stopped,
          settings: { ...settings, enableManagedAgentTerminal: false },
          ...harness,
          ensurePreviousOwnerExited: () =>
            Effect.fail(
              new TerminalAgentServiceError({
                reason: "invalid-state",
                message: "Persisted PID 4242 is still present.",
              }),
            ),
          resolveTarget: () => Effect.succeed(target),
          launch: () => Effect.succeed(undefined),
        }),
      ),
    ).rejects.toThrow("still present");

    expect(harness.switches()).toBe(0);
    expect(harness.getState()).toMatchObject({
      adapter: "terminal",
      status: "error",
    });
  });

  it("tombstones a stopped terminal whose Thread was deleted", async () => {
    const stopped = terminalState({
      status: "stopped",
      pid: null,
      ownerIdentity: null,
      processGroupIdentity: null,
    });
    const harness = makeHarness(stopped);

    await Effect.runPromise(
      recoverTerminalRuntime({
        threadId,
        state: stopped,
        settings,
        ...harness,
        resolveTarget: resolutionFailure,
        launch: () => Effect.succeed(undefined),
      }),
    );

    expect(harness.ownerChecks()).toBe(0);
    expect(harness.teardowns()).toBe(1);
    expect(harness.switches()).toBe(0);
    expect(harness.retiredRuntimes()).toBe(1);
  });

  it("conservatively completes an interrupted stop without auto-restarting", async () => {
    const state = terminalState({ status: "stopping" });
    const harness = makeHarness(state);
    let launches = 0;

    await Effect.runPromise(
      recoverTerminalRuntime({
        threadId,
        state,
        settings,
        ...harness,
        resolveTarget: () => Effect.succeed(target),
        launch: () => {
          launches += 1;
          return Effect.succeed(undefined);
        },
      }),
    );

    expect(launches).toBe(0);
    expect(harness.ownerChecks()).toBe(1);
    expect(harness.retiredRuntimes()).toBe(1);
    expect(harness.getState()).toMatchObject({
      adapter: "terminal",
      status: "stopped",
      activeTurnId: null,
    });
  });

  it("tombstones terminal authority when its Thread can no longer resolve", async () => {
    const harness = makeHarness(terminalState());

    await Effect.runPromise(
      recoverTerminalRuntime({
        threadId,
        state: terminalState(),
        settings,
        ...harness,
        resolveTarget: resolutionFailure,
        launch: () => Effect.succeed(undefined),
      }),
    );

    expect(harness.switches()).toBe(0);
    expect(harness.teardowns()).toBe(1);
    expect(harness.retiredRuntimes()).toBe(1);
    expect(harness.getState()).toMatchObject({ adapter: "structured" });
  });

  it("does not restart an individually disabled provider", async () => {
    const harness = makeHarness(terminalState({ status: "ready" }));
    let launches = 0;

    await Effect.runPromise(
      recoverTerminalRuntime({
        threadId,
        state: terminalState({ status: "ready" }),
        settings: {
          ...settings,
          providers: {
            ...settings.providers,
            codex: { ...settings.providers.codex, enabled: false },
          },
        },
        ...harness,
        resolveTarget: () => Effect.succeed(target),
        launch: () => {
          launches += 1;
          return Effect.succeed(undefined);
        },
      }),
    );

    expect(launches).toBe(0);
    expect(harness.switches()).toBe(1);
    expect(harness.retiredRuntimes()).toBe(1);
    expect(harness.getState()).toMatchObject({ adapter: "structured" });
  });

  it("fails closed instead of duplicating a persisted owner that is still present", async () => {
    const state = terminalState({ status: "ready", pid: 4242 });
    const harness = makeHarness(state);
    let launches = 0;

    await expect(
      Effect.runPromise(
        recoverTerminalRuntime({
          threadId,
          state,
          settings: { ...settings, enableManagedAgentTerminal: false },
          ...harness,
          ensurePreviousOwnerExited: () =>
            Effect.fail(
              new TerminalAgentServiceError({
                reason: "invalid-state",
                message: "Persisted PID 4242 is still present.",
              }),
            ),
          resolveTarget: () => Effect.succeed(target),
          launch: () => {
            launches += 1;
            return Effect.succeed(undefined);
          },
        }),
      ),
    ).rejects.toThrow("still present");

    expect(launches).toBe(0);
    expect(harness.switches()).toBe(0);
    expect(harness.retiredRuntimes()).toBe(0);
    expect(harness.getState()).toMatchObject({
      adapter: "terminal",
      status: "error",
      activeTurnId: null,
      error: expect.stringContaining("still present"),
    });
  });

  it("retires the distinct persisted runtime only after a successful respawn", async () => {
    const state = terminalState({ status: "ready" });
    const harness = makeHarness(state);

    await Effect.runPromise(
      recoverTerminalRuntime({
        threadId,
        state,
        settings,
        ...harness,
        resolveTarget: () => Effect.succeed(target),
        launch: () => Effect.succeed(undefined),
      }),
    );

    expect(harness.ownerChecks()).toBe(1);
    expect(harness.retiredRuntimes()).toBe(1);
  });

  it("keeps failed auto-restarts explicit and retryable instead of phantom ready", async () => {
    const harness = makeHarness(terminalState({ status: "ready" }));

    await expect(
      Effect.runPromise(
        recoverTerminalRuntime({
          threadId,
          state: terminalState({ status: "ready" }),
          settings,
          ...harness,
          resolveTarget: () => Effect.succeed(target),
          launch: () =>
            Effect.fail(
              new TerminalAgentServiceError({
                reason: "probe-failed",
                message: "CLI unavailable.",
              }),
            ),
        }),
      ),
    ).rejects.toThrow("CLI unavailable");

    expect(harness.getState()).toMatchObject({
      adapter: "terminal",
      status: "error",
      activeTurnId: null,
      error: expect.stringContaining("CLI unavailable"),
    });
  });

  it("projects a fenced abort before releasing an interrupted runtime", async () => {
    const interrupted = terminalState({
      status: "running",
      activeTurnId: "turn-active",
    });
    const harness = makeHarness(interrupted);

    await Effect.runPromise(
      recoverTerminalRuntime({
        threadId,
        state: interrupted,
        settings,
        ...harness,
        resolveTarget: resolutionFailure,
        launch: () => Effect.succeed(undefined),
      }),
    );

    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      type: "turn.aborted",
      threadId,
      turnId: "turn-active",
      terminalRuntimeFence: {
        revision: 7,
        generation: "generation-1",
      },
    });
    expect(harness.switches()).toBe(0);
    expect(harness.teardowns()).toBe(1);
  });
});
