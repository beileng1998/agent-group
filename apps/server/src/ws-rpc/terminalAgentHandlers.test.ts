import {
  ThreadId,
  WS_METHODS,
  WsRpcError,
  type TerminalAgentEvent,
  type TerminalAgentRuntimeState,
  type TerminalAgentStartInput,
} from "@agent-group/contracts";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  TerminalAgentServiceError,
  type TerminalAgentServiceShape,
} from "../terminalAgent/Services/TerminalAgentService";
import {
  makeServerRuntimeStartup,
  type ServerRuntimeStartupShape,
} from "../serverRuntimeStartup";
import { toWsRpcError } from "../wsRpcError";
import { makeTerminalAgentHandlers } from "./terminalAgentHandlers";

const threadId = ThreadId.makeUnsafe("thread-1");

function runtimeState(revision: number): TerminalAgentRuntimeState {
  return {
    threadId,
    authority: "structured",
    revision,
    provider: "codex",
    status: "idle",
    runtimeInstanceId: null,
    generation: null,
    pid: null,
    providerSessionId: null,
    model: null,
    effort: null,
    permission: null,
    capabilities: null,
    exit: null,
    error: null,
  };
}

const rpcEffect = <A, E, R>(effect: Effect.Effect<A, E, R>, fallbackMessage: string) =>
  effect.pipe(Effect.mapError((cause) => toWsRpcError(cause, fallbackMessage)));

const readyRuntimeStartup: ServerRuntimeStartupShape = {
  awaitCommandReady: Effect.void,
  markCommandReady: Effect.void,
  failCommandReady: () => Effect.void,
  enqueueCommand: (effect) => effect,
};

function makeHarness(options?: {
  readonly getError?: TerminalAgentServiceError;
  readonly events?: ReadonlyArray<TerminalAgentEvent>;
  readonly stream?: Stream.Stream<TerminalAgentEvent, TerminalAgentServiceError>;
  readonly streamError?: TerminalAgentServiceError;
  readonly runtimeStartup?: ServerRuntimeStartupShape;
}) {
  const calls: Array<{ readonly operation: string; readonly input: unknown }> = [];
  const record = <A>(operation: string, input: unknown, result: A) =>
    Effect.sync(() => {
      calls.push({ operation, input });
      return result;
    });
  const state = runtimeState(1);
  const service: TerminalAgentServiceShape = {
    get: (input) =>
      options?.getError
        ? Effect.fail(options.getError)
        : record("get", input, state),
    start: (input) => record("start", input, state),
    restart: (input) => record("restart", input, state),
    switchToChat: (input) => record("switchToChat", input, state),
    stopCurrentAdapter: (input) =>
      record("stopCurrentAdapter", input, "structured" as const),
    write: (input) => record("write", input, undefined),
    resize: (input) => record("resize", input, undefined),
    subscribe: (input, mode) => {
      calls.push({ operation: "subscribe", input: { threadId: input, mode } });
      return options?.stream
        ? options.stream
        : options?.streamError
        ? Stream.fail(options.streamError)
        : Stream.fromIterable(options?.events ?? []);
    },
    teardownThread: () => Effect.void,
    recover: Effect.void,
  };

  return {
    calls,
    handlers: makeTerminalAgentHandlers({
      runtimeStartup: options?.runtimeStartup ?? readyRuntimeStartup,
      terminalAgentService: service,
      rpcEffect,
    }),
  };
}

describe("managed terminal RPC handlers", () => {
  it("routes every public command", async () => {
    const { calls, handlers } = makeHarness();
    const startInput: TerminalAgentStartInput = { threadId, cols: 100, rows: 32 };
    const fence = { threadId, revision: 1, generation: "generation-1" };

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* handlers[WS_METHODS.terminalAgentGet]({ threadId });
        yield* handlers[WS_METHODS.terminalAgentStart](startInput);
        yield* handlers[WS_METHODS.terminalAgentRestart](startInput);
        yield* handlers[WS_METHODS.terminalAgentSwitchToChat]({ threadId });
        yield* handlers[WS_METHODS.terminalAgentWrite]({ ...fence, data: "hello" });
        yield* handlers[WS_METHODS.terminalAgentResize]({ ...fence, cols: 120, rows: 40 });
      }),
    );

    expect(calls).toEqual([
      { operation: "get", input: threadId },
      { operation: "start", input: startInput },
      { operation: "restart", input: startInput },
      { operation: "switchToChat", input: threadId },
      { operation: "write", input: { ...fence, data: "hello" } },
      { operation: "resize", input: { ...fence, cols: 120, rows: 40 } },
    ]);
  });

  it("projects service failures to WsRpcError", async () => {
    const { handlers } = makeHarness({
      getError: new TerminalAgentServiceError({
        reason: "invalid-state",
        message: "Terminal is busy",
      }),
    });

    const error = await Effect.runPromise(
      Effect.flip(handlers[WS_METHODS.terminalAgentGet]({ threadId })),
    );

    expect(error).toBeInstanceOf(WsRpcError);
    expect(error.message).toBe("Terminal is busy");
  });

  it("queues terminal reads and mutations until runtime recovery is ready", async () => {
    const runtimeStartup = await Effect.runPromise(makeServerRuntimeStartup);
    const { calls, handlers } = makeHarness({ runtimeStartup });
    const startInput: TerminalAgentStartInput = { threadId, cols: 100, rows: 32 };
    const fence = { threadId, revision: 1, generation: "generation-1" };
    const pending = [
      Effect.runPromise(handlers[WS_METHODS.terminalAgentGet]({ threadId })),
      Effect.runPromise(handlers[WS_METHODS.terminalAgentStart](startInput)),
      Effect.runPromise(handlers[WS_METHODS.terminalAgentRestart](startInput)),
      Effect.runPromise(
        handlers[WS_METHODS.terminalAgentSwitchToChat]({ threadId }),
      ),
      Effect.runPromise(
        handlers[WS_METHODS.terminalAgentWrite]({ ...fence, data: "hello" }),
      ),
      Effect.runPromise(
        handlers[WS_METHODS.terminalAgentResize]({
          ...fence,
          cols: 120,
          rows: 40,
        }),
      ),
    ];

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual([]);
    await Effect.runPromise(runtimeStartup.markCommandReady);
    await Promise.all(pending);
    expect(calls.map(({ operation }) => operation)).toEqual([
      "get",
      "start",
      "restart",
      "switchToChat",
      "write",
      "resize",
    ]);
  });

  it("forwards the complete persistent subscription stream", async () => {
    const events: TerminalAgentEvent[] = [
      { type: "state", state: runtimeState(1) },
      { type: "state", state: runtimeState(2) },
      { type: "state", state: runtimeState(3) },
    ];
    const { calls, handlers } = makeHarness({ events });

    const received = await Effect.runPromise(
      handlers[WS_METHODS.terminalAgentSubscribe]({
        threadId,
        mode: "state",
      }).pipe(Stream.runCollect),
    );

    expect(Array.from(received)).toEqual(events);
    expect(calls).toEqual([
      {
        operation: "subscribe",
        input: { threadId, mode: "state" },
      },
    ]);
  });

  it("does not attach a terminal subscription before runtime recovery is ready", async () => {
    const runtimeStartup = await Effect.runPromise(makeServerRuntimeStartup);
    const event: TerminalAgentEvent = {
      type: "state",
      state: runtimeState(1),
    };
    const { calls, handlers } = makeHarness({
      events: [event],
      runtimeStartup,
    });
    const collecting = Effect.runPromise(
      handlers[WS_METHODS.terminalAgentSubscribe]({
        threadId,
        mode: "terminal",
      }).pipe(Stream.runCollect),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual([]);
    await Effect.runPromise(runtimeStartup.markCommandReady);
    await expect(collecting).resolves.toEqual([event]);
    expect(calls).toEqual([
      {
        operation: "subscribe",
        input: { threadId, mode: "terminal" },
      },
    ]);
  });

  it("projects subscription failures without replacing the stream", async () => {
    const failure = new TerminalAgentServiceError({
      reason: "stale-runtime",
      message: "Runtime changed",
    });
    const { handlers } = makeHarness({ streamError: failure });
    const stream = handlers[WS_METHODS.terminalAgentSubscribe]({ threadId });

    const error = await Effect.runPromise(Effect.flip(stream.pipe(Stream.runDrain)));

    expect(error).toBeInstanceOf(WsRpcError);
    expect(error.message).toBe("Runtime changed");
  });

  it("fails a slow terminal subscriber before large output can build an event-only backlog", async () => {
    const data = "x".repeat(3 * 1024 * 1024);
    const events: TerminalAgentEvent[] = [2, 3, 4].map((seq) => ({
      type: "output",
      threadId,
      revision: 1,
      generation: "generation-1",
      seq,
      data,
    }));
    const { handlers } = makeHarness({
      stream: Stream.fromIterable(events),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        handlers[WS_METHODS.terminalAgentSubscribe]({
          threadId,
          mode: "terminal",
        }).pipe(
          Stream.tap(() => Effect.sleep("20 millis")),
          Stream.runDrain,
        ),
      ),
    );

    expect(error).toBeInstanceOf(WsRpcError);
    expect(error.message).toMatch(/fresh snapshot/);
  });
});
