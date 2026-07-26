import { ThreadId } from "@agent-group/contracts";
import { Effect, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import type {
  ExecutionAdapterCoordinatorShape,
  ExecutionAdapterState,
} from "../orchestration/Services/ExecutionAdapterCoordinator";
import { makeTerminalAgentSubscription } from "./terminalAgentSubscription";

const threadId = ThreadId.makeUnsafe("thread-subscription-backpressure");

function terminalState(generation: string): ExecutionAdapterState {
  return {
    adapter: "terminal",
    revision: 10,
    provider: "codex",
    status: "ready",
    runtimeInstanceId: "runtime-10",
    generation,
    pid: 50,
    ownerIdentity: {
      pid: 50,
      startTime: "Sat Jul 25 00:00:00 2026",
      commandFingerprint: "0".repeat(64),
    },
    processGroupIdentity: null,
    providerSessionId: "provider-session-10",
    activeTurnId: null,
    startedAt: new Date().toISOString(),
    exitCode: null,
    exitSignal: null,
    error: null,
  };
}

function attachResult(generation: string, unsubscribe: () => void) {
  return {
    attached: {
      isNew: false,
      generation,
      pid: 50,
      processGroupIdentity: null,
      snapshot: {
        snapshotAnsi: "screen",
        scrollbackAnsi: "",
        rehydrateSequences: "",
        modes: {},
        cols: 80,
        rows: 24,
        scrollbackLines: 0,
        outputSequence: 1,
      },
    },
    unsubscribe,
  };
}

function runSubscription(coordinator: ExecutionAdapterCoordinatorShape) {
  return Effect.runPromise(
    makeTerminalAgentSubscription({
      threadId,
      provider: "codex",
      coordinator,
      runtimeForThread: () => undefined,
      includeOutput: true,
    }).pipe(Stream.runDrain),
  );
}

describe("managed terminal subscription attach backpressure", () => {
  it("fails when buffering overflows during snapshot reconciliation", async () => {
    const generation = "generation-10-late";
    const state = terminalState(generation);
    const unsubscribe = vi.fn();
    let emitOutput: ((output: { seq: number; data: string; generation: string }) => void) | null =
      null;
    const coordinator = {
      getState: () =>
        Effect.sync(() => {
          emitOutput?.({
            seq: 2,
            data: "x".repeat(4 * 1024 * 1024 + 1),
            generation,
          });
          return state;
        }),
      streamChanges: Stream.empty,
      attachClient: (input: {
        onOutput: (output: { seq: number; data: string; generation: string }) => void;
      }) =>
        Effect.sync(() => {
          emitOutput = input.onOutput;
          return attachResult(generation, unsubscribe);
        }),
    } as unknown as ExecutionAdapterCoordinatorShape;

    await expect(runSubscription(coordinator)).rejects.toThrow(/fresh snapshot/);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("bounds snapshot buffering by event count as well as bytes", async () => {
    const generation = "generation-10-events";
    const state = terminalState(generation);
    const unsubscribe = vi.fn();
    const coordinator = {
      getState: () => Effect.succeed(state),
      streamChanges: Stream.empty,
      attachClient: (input: {
        onOutput: (output: { seq: number; data: string; generation: string }) => void;
      }) =>
        Effect.sync(() => {
          for (let seq = 2; seq <= 258; seq += 1) {
            input.onOutput({ seq, data: "x", generation });
          }
          return attachResult(generation, unsubscribe);
        }),
    } as unknown as ExecutionAdapterCoordinatorShape;

    await expect(runSubscription(coordinator)).rejects.toThrow(/fresh snapshot/);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
