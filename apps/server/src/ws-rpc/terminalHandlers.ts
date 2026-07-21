import {
  CommandId,
  DEFAULT_TERMINAL_ID,
  ThreadId,
  WS_METHODS,
  WsRpcError,
} from "@agent-group/contracts";
import { Effect, Queue, Stream } from "effect";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { TerminalManager } from "../terminal/Services/Manager";
import { TerminalThreadTitleTracker } from "../terminal/terminalThreadTitleTracker";
import type { WsRpcHandlers } from "./types";

export function makeTerminalHandlers(dependencies: {
  readonly orchestrationEngine: typeof OrchestrationEngineService.Service;
  readonly terminalManager: typeof TerminalManager.Service;
  readonly rpcEffect: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    fallbackMessage: string,
  ) => Effect.Effect<A, WsRpcError, R>;
}) {
  const terminalTitleTracker = new TerminalThreadTitleTracker();
  const resetTerminalTitleBuffer = (threadId: string, terminalId: string | null) =>
    Effect.sync(() => terminalTitleTracker.reset(threadId, terminalId));
  const maybeAutoRenameTerminalThread = Effect.fnUntraced(function* (input: {
    threadId: string;
    terminalId: string;
    data: string;
  }) {
    const readModel = yield* dependencies.orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === input.threadId);
    if (!thread) return;
    const nextTitle = terminalTitleTracker.consumeWrite({
      currentTitle: thread.title,
      data: input.data,
      terminalId: input.terminalId,
      threadId: input.threadId,
    });
    if (!nextTitle) return;
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.meta.update",
      commandId: CommandId.makeUnsafe(`server:terminal-title-rename:${crypto.randomUUID()}`),
      threadId: ThreadId.makeUnsafe(input.threadId),
      title: nextTitle,
    });
  });

  return {
    [WS_METHODS.terminalOpen]: (input) =>
      dependencies.rpcEffect(
        resetTerminalTitleBuffer(input.threadId, input.terminalId ?? DEFAULT_TERMINAL_ID).pipe(
          Effect.andThen(dependencies.terminalManager.open(input)),
        ),
        "Failed to open terminal",
      ),
    [WS_METHODS.terminalWrite]: (input) =>
      dependencies.rpcEffect(
        dependencies.terminalManager.write(input).pipe(
          Effect.tap(() =>
            maybeAutoRenameTerminalThread({
              threadId: input.threadId,
              terminalId: input.terminalId ?? DEFAULT_TERMINAL_ID,
              data: input.data,
            }).pipe(Effect.catch(() => Effect.void)),
          ),
        ),
        "Failed to write terminal",
      ),
    [WS_METHODS.terminalAckOutput]: (input) =>
      dependencies.rpcEffect(
        dependencies.terminalManager.ackOutput(input),
        "Failed to acknowledge terminal output",
      ),
    [WS_METHODS.terminalResize]: (input) =>
      dependencies.rpcEffect(
        dependencies.terminalManager.resize(input),
        "Failed to resize terminal",
      ),
    [WS_METHODS.terminalClear]: (input) =>
      dependencies.rpcEffect(dependencies.terminalManager.clear(input), "Failed to clear terminal"),
    [WS_METHODS.terminalRestart]: (input) =>
      dependencies.rpcEffect(
        resetTerminalTitleBuffer(input.threadId, input.terminalId ?? DEFAULT_TERMINAL_ID).pipe(
          Effect.andThen(dependencies.terminalManager.restart(input)),
        ),
        "Failed to restart terminal",
      ),
    [WS_METHODS.terminalClose]: (input) =>
      dependencies.rpcEffect(
        resetTerminalTitleBuffer(input.threadId, input.terminalId ?? null).pipe(
          Effect.andThen(dependencies.terminalManager.close(input)),
        ),
        "Failed to close terminal",
      ),
    [WS_METHODS.subscribeTerminalEvents]: () =>
      Stream.callback((queue) =>
        Effect.gen(function* () {
          const unsubscribe = yield* dependencies.terminalManager.subscribe((event) => {
            Effect.runFork(Queue.offer(queue, event).pipe(Effect.asVoid));
          });
          yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
        }),
      ),
  } satisfies Partial<WsRpcHandlers>;
}
