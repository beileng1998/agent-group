import { ThreadId } from "@agent-group/contracts";
import { Effect, Queue, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import type {
  ExecutionAdapterChange,
  ExecutionAdapterCoordinatorShape,
  ExecutionAdapterState,
} from "../orchestration/Services/ExecutionAdapterCoordinator";
import { makeTerminalAgentSubscription } from "./terminalAgentSubscription";

const threadId = ThreadId.makeUnsafe("thread-subscription");

function terminalState(
  revision: number,
  generation: string,
): Extract<ExecutionAdapterState, { adapter: "terminal" }> {
  return {
    adapter: "terminal",
    revision,
    provider: "codex",
    status: "ready",
    runtimeInstanceId: `runtime-${revision}`,
    generation,
    pid: 40 + revision,
    ownerIdentity: {
      pid: 40 + revision,
      startTime: "Sat Jul 25 00:00:00 2026",
      commandFingerprint: "0".repeat(64),
    },
    processGroupIdentity: null,
    providerSessionId: `provider-session-${revision}`,
    activeTurnId: null,
    startedAt: new Date().toISOString(),
    exitCode: null,
    exitSignal: null,
    error: null,
  };
}

function attachResult(generation: string, unsubscribe = () => {}) {
  return {
    attached: {
      isNew: false,
      generation,
      pid: 42,
      processGroupIdentity: null,
      snapshot: {
        snapshotAnsi: `screen:${generation}`,
        scrollbackAnsi: "history",
        rehydrateSequences: "modes",
        modes: {},
        cols: 80,
        rows: 24,
        scrollbackLines: 1,
        outputSequence: 1,
      },
    },
    unsubscribe,
  };
}

describe("managed terminal subscription", () => {
  it("emits the xterm snapshot before buffered output and drops covered sequences", async () => {
    const state = terminalState(4, "generation-1");
    const coordinator = {
      getState: () => Effect.succeed(state),
      streamChanges: Stream.empty,
      attachClient: (input: {
        onOutput: (output: { seq: number; data: string; generation: string }) => void;
      }) =>
        Effect.sync(() => {
          input.onOutput({
            seq: 1,
            data: "covered",
            generation: "generation-1",
          });
          input.onOutput({
            seq: 2,
            data: "live",
            generation: "generation-1",
          });
          return attachResult("generation-1");
        }),
    } as unknown as ExecutionAdapterCoordinatorShape;

    const events = await Effect.runPromise(
      makeTerminalAgentSubscription({
        threadId,
        provider: "codex",
        coordinator,
        runtimeForThread: () => undefined,
        includeOutput: true,
      }).pipe(Stream.take(3), Stream.runCollect),
    );

    expect([...events].map((event) => event.type)).toEqual(["attached", "output", "state"]);
    expect([...events][1]).toMatchObject({
      type: "output",
      seq: 2,
      data: "live",
    });
  });

  it("acquires the change stream before reading the initial authority snapshot", async () => {
    const calls: string[] = [];
    let state: ExecutionAdapterState = terminalState(6, "generation-before-subscribe");
    const coordinator = {
      streamChanges: Stream.callback<ExecutionAdapterChange>((queue) =>
        Effect.gen(function* () {
          calls.push("subscribe");
          state = terminalState(7, "generation-after-subscribe");
          yield* Queue.offer(queue, {
            threadId,
            state,
            changedAt: new Date().toISOString(),
          });
        }),
      ),
      getState: () =>
        Effect.sync(() => {
          calls.push("get");
          return state;
        }),
      attachClient: () => Effect.succeed(attachResult("generation-after-subscribe")),
    } as unknown as ExecutionAdapterCoordinatorShape;

    const events = await Effect.runPromise(
      makeTerminalAgentSubscription({
        threadId,
        provider: "codex",
        coordinator,
        runtimeForThread: () => undefined,
        includeOutput: true,
      }).pipe(Stream.take(2), Stream.runCollect),
    );

    expect(calls[0]).toBe("subscribe");
    expect(calls[1]).toBe("get");
    expect([...events]).toMatchObject([
      {
        type: "attached",
        revision: 7,
        generation: "generation-after-subscribe",
      },
      {
        type: "state",
        state: {
          revision: 7,
          generation: "generation-after-subscribe",
        },
      },
    ]);
  });

  it("discards a stale attach and reconciles the latest epoch changed during snapshotting", async () => {
    const attachedEpochs: Array<{ revision: number; generation: string }> = [];
    const staleUnsubscribe = vi.fn();
    const latestUnsubscribe = vi.fn();

    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const changes = yield* Queue.unbounded<ExecutionAdapterChange>();
        let state: ExecutionAdapterState = terminalState(4, "generation-4");
        const coordinator = {
          streamChanges: Stream.fromQueue(changes),
          getState: () => Effect.sync(() => state),
          attachClient: (input: { revision: number; generation: string }) =>
            Effect.gen(function* () {
              attachedEpochs.push({
                revision: input.revision,
                generation: input.generation,
              });
              if (input.generation === "generation-4") {
                state = terminalState(5, "generation-5");
                yield* Queue.offer(changes, {
                  threadId,
                  state,
                  changedAt: new Date().toISOString(),
                });
                return attachResult(input.generation, staleUnsubscribe);
              }
              return attachResult(input.generation, latestUnsubscribe);
            }),
        } as unknown as ExecutionAdapterCoordinatorShape;

        return yield* makeTerminalAgentSubscription({
          threadId,
          provider: "codex",
          coordinator,
          runtimeForThread: () => undefined,
          includeOutput: true,
        }).pipe(Stream.take(2), Stream.runCollect);
      }),
    );

    expect(attachedEpochs).toEqual([
      { revision: 4, generation: "generation-4" },
      { revision: 5, generation: "generation-5" },
    ]);
    expect(staleUnsubscribe).toHaveBeenCalledOnce();
    expect(latestUnsubscribe).toHaveBeenCalledOnce();
    expect([...events]).toMatchObject([
      {
        type: "attached",
        revision: 5,
        generation: "generation-5",
        snapshot: { snapshotAnsi: "screen:generation-5" },
      },
      {
        type: "state",
        state: {
          revision: 5,
          generation: "generation-5",
        },
      },
    ]);
  });

  it("does not attach PTY output for state-only subscriptions", async () => {
    const attachClient = vi.fn();
    const state = terminalState(8, "generation-8");
    const coordinator = {
      getState: () => Effect.succeed(state),
      streamChanges: Stream.empty,
      attachClient,
    } as unknown as ExecutionAdapterCoordinatorShape;

    const events = await Effect.runPromise(
      makeTerminalAgentSubscription({
        threadId,
        provider: "codex",
        coordinator,
        runtimeForThread: () => undefined,
        includeOutput: false,
      }).pipe(Stream.take(1), Stream.runCollect),
    );

    expect(attachClient).not.toHaveBeenCalled();
    expect([...events]).toMatchObject([
      {
        type: "state",
        state: { status: "ready", generation: "generation-8" },
      },
    ]);
  });

  it.each(["starting", "stopping", "stopped", "exited", "unsupported"] as const)(
    "does not turn a %s runtime into an attach error",
    async (status) => {
      const attachClient = vi.fn();
      const state = { ...terminalState(9, "generation-9"), status };
      const coordinator = {
        getState: () => Effect.succeed(state),
        streamChanges: Stream.empty,
        attachClient,
      } as unknown as ExecutionAdapterCoordinatorShape;

      const events = await Effect.runPromise(
        makeTerminalAgentSubscription({
          threadId,
          provider: "codex",
          coordinator,
          runtimeForThread: () => undefined,
          includeOutput: true,
        }).pipe(Stream.take(1), Stream.runCollect),
      );

      expect(attachClient).not.toHaveBeenCalled();
      expect([...events][0]).toMatchObject({
        type: "state",
        state: { status },
      });
    },
  );

  it("fails attach so the client resubscribes when snapshot buffering exceeds its bound", async () => {
    const state = terminalState(10, "generation-10");
    const unsubscribe = vi.fn();
    const coordinator = {
      getState: () => Effect.succeed(state),
      streamChanges: Stream.empty,
      attachClient: (input: {
        onOutput: (output: { seq: number; data: string; generation: string }) => void;
      }) =>
        Effect.sync(() => {
          input.onOutput({
            seq: 1,
            data: "x".repeat(4 * 1024 * 1024 + 1),
            generation: "generation-10",
          });
          return attachResult("generation-10", unsubscribe);
        }),
    } as unknown as ExecutionAdapterCoordinatorShape;

    await expect(
      Effect.runPromise(
        makeTerminalAgentSubscription({
          threadId,
          provider: "codex",
          coordinator,
          runtimeForThread: () => undefined,
          includeOutput: true,
        }).pipe(Stream.runDrain),
      ),
    ).rejects.toThrow(/fresh snapshot/);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("serializes live output and exit callbacks in the order the host emits them", async () => {
    const state = terminalState(11, "generation-11");
    const coordinator = {
      getState: () => Effect.succeed(state),
      streamChanges: Stream.empty,
      attachClient: (input: {
        onOutput: (output: { seq: number; data: string; generation: string }) => void;
        onExit: (exit: { exitCode: number; signal: number | null; generation: string }) => void;
      }) =>
        Effect.sync(() => {
          queueMicrotask(() => {
            input.onOutput({
              seq: 2,
              data: "last output",
              generation: "generation-11",
            });
            input.onExit({
              exitCode: 0,
              signal: null,
              generation: "generation-11",
            });
          });
          return attachResult("generation-11");
        }),
    } as unknown as ExecutionAdapterCoordinatorShape;

    const events = await Effect.runPromise(
      makeTerminalAgentSubscription({
        threadId,
        provider: "codex",
        coordinator,
        runtimeForThread: () => undefined,
        includeOutput: true,
      }).pipe(Stream.take(4), Stream.runCollect),
    );

    expect([...events].map((event) => event.type)).toEqual([
      "attached",
      "state",
      "output",
      "exited",
    ]);
  });

  it("fails live output when its pending byte budget is exceeded", async () => {
    const state = terminalState(13, "generation-13");
    const unsubscribe = vi.fn();
    const coordinator = {
      getState: () => Effect.succeed(state),
      streamChanges: Stream.empty,
      attachClient: (input: {
        onOutput: (output: { seq: number; data: string; generation: string }) => void;
      }) =>
        Effect.sync(() => {
          queueMicrotask(() => {
            input.onOutput({
              seq: 2,
              data: "x".repeat(4 * 1024 * 1024 + 1),
              generation: "generation-13",
            });
          });
          return attachResult("generation-13", unsubscribe);
        }),
    } as unknown as ExecutionAdapterCoordinatorShape;

    await expect(
      Effect.runPromise(
        makeTerminalAgentSubscription({
          threadId,
          provider: "codex",
          coordinator,
          runtimeForThread: () => undefined,
          includeOutput: true,
        }).pipe(Stream.runDrain),
      ),
    ).rejects.toThrow(/fresh snapshot/);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not retry an oversized snapshot for the same runtime epoch", async () => {
    const changes = await Effect.runPromise(Queue.unbounded<ExecutionAdapterChange>());
    let state: ExecutionAdapterState = terminalState(12, "generation-12");
    const attachClient = vi.fn(() =>
      Effect.fail({
        reason: "host",
        message: "Terminal attach failed.",
        cause: {
          reason: "snapshot-too-large",
        },
      }),
    );
    const coordinator = {
      getState: () => Effect.succeed(state),
      streamChanges: Stream.fromQueue(changes),
      attachClient,
      updateTerminalState: () =>
        Effect.gen(function* () {
          state = { ...terminalState(12, "generation-12"), status: "error" };
          yield* Queue.offer(changes, {
            threadId,
            state,
            changedAt: new Date().toISOString(),
          });
          return state;
        }),
    } as unknown as ExecutionAdapterCoordinatorShape;

    const events = await Effect.runPromise(
      makeTerminalAgentSubscription({
        threadId,
        provider: "codex",
        coordinator,
        runtimeForThread: () => undefined,
        includeOutput: true,
      }).pipe(Stream.take(2), Stream.runCollect),
    );

    expect([...events].map((event) => event.type)).toEqual(["state", "state"]);
    expect(attachClient).toHaveBeenCalledOnce();
  });
});
