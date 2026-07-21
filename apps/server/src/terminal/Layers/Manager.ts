// FILE: Manager.ts
// Purpose: Compatibility entrypoint for terminal session orchestration.
// Layer: Terminal infrastructure
import { describeErrorMessage } from "@agent-group/shared/errorMessages";
import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config";
import { PtyAdapter } from "../Services/PTY";
import { TerminalError, TerminalManager, type TerminalManagerShape } from "../Services/Manager";
import { TerminalManagerRuntime } from "./terminal-manager/TerminalManagerRuntime";

export { TerminalManagerRuntime } from "./terminal-manager/TerminalManagerRuntime";
export { __terminalManagerShellTesting } from "./terminal-manager/terminalShellEnvironment";
export {
  inspectSubprocessActivity,
  type TerminalSubprocessActivity,
} from "./terminal-manager/terminalSubprocessInspection";

function terminalErrorFromCause(fallbackMessage: string, cause: unknown): TerminalError {
  return new TerminalError({
    message: describeErrorMessage(cause, fallbackMessage),
    cause,
  });
}

export const TerminalManagerLive = Layer.effect(
  TerminalManager,
  Effect.gen(function* () {
    const { terminalLogsDir } = yield* ServerConfig;
    const ptyAdapter = yield* PtyAdapter;
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() => new TerminalManagerRuntime({ logsDir: terminalLogsDir, ptyAdapter })),
      (manager) => Effect.promise(() => manager.disposeForShutdown()),
    );

    return {
      open: (input) =>
        Effect.tryPromise({
          try: () => runtime.open(input),
          catch: (cause) => terminalErrorFromCause("Failed to open terminal", cause),
        }),
      write: (input) =>
        Effect.tryPromise({
          try: () => runtime.write(input),
          catch: (cause) => terminalErrorFromCause("Failed to write to terminal", cause),
        }),
      ackOutput: (input) =>
        Effect.tryPromise({
          try: () => runtime.ackOutput(input),
          catch: (cause) => terminalErrorFromCause("Failed to acknowledge terminal output", cause),
        }),
      resize: (input) =>
        Effect.tryPromise({
          try: () => runtime.resize(input),
          catch: (cause) => terminalErrorFromCause("Failed to resize terminal", cause),
        }),
      clear: (input) =>
        Effect.tryPromise({
          try: () => runtime.clear(input),
          catch: (cause) => terminalErrorFromCause("Failed to clear terminal", cause),
        }),
      restart: (input) =>
        Effect.tryPromise({
          try: () => runtime.restart(input),
          catch: (cause) => terminalErrorFromCause("Failed to restart terminal", cause),
        }),
      close: (input) =>
        Effect.tryPromise({
          try: () => runtime.close(input),
          catch: (cause) => terminalErrorFromCause("Failed to close terminal", cause),
        }),
      subscribe: (listener) =>
        Effect.sync(() => {
          runtime.on("event", listener);
          return () => runtime.off("event", listener);
        }),
      dispose: Effect.promise(() => runtime.disposeForShutdown()),
    } satisfies TerminalManagerShape;
  }),
);
