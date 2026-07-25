// FILE: TerminalHostService.ts
// Purpose: Effect service boundary for TerminalHost — managed-agent PTY
// sessions with create-or-attach identity, generation epochs, and snapshot
// restore. Not wired into serverLayers until the orchestration admission
// boundary lands (see docs/plans/embedded-agent-terminal-redo.md).
// Layer: Server terminal host service

import { Effect, Layer, Schema, ServiceMap } from "effect";

import { PtyAdapter } from "../terminal/Services/PTY";
import { TerminalHost } from "./TerminalHost";
import type {
  TerminalHostAttachResult,
  TerminalHostExit,
  TerminalHostGeneration,
  TerminalHostOutput,
  TerminalHostSpawnInput,
} from "./TerminalHost";
import { TerminalHostSessionNotFoundError, TerminalHostStaleGenerationError } from "./TerminalHost";
import type { TerminalSnapshot } from "./terminal-snapshot";

export class TerminalHostError extends Schema.TaggedErrorClass<TerminalHostError>()(
  "TerminalHostError",
  {
    reason: Schema.Literals(["not-found", "stale-generation", "spawn-failed", "unknown"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

const toTerminalHostError = (error: unknown): TerminalHostError => {
  if (error instanceof TerminalHostSessionNotFoundError) {
    return new TerminalHostError({ reason: "not-found", message: error.message });
  }
  if (error instanceof TerminalHostStaleGenerationError) {
    return new TerminalHostError({ reason: "stale-generation", message: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new TerminalHostError({ reason: "unknown", message, cause: error });
};

export interface TerminalHostServiceShape {
  /** Spawn a new managed session or attach to the live one with the same id. */
  readonly createOrAttach: (
    input: TerminalHostSpawnInput,
  ) => Effect.Effect<TerminalHostAttachResult, TerminalHostError>;
  /** Attach to an existing live session; never spawns. */
  readonly attach: (
    sessionId: string,
  ) => Effect.Effect<TerminalHostAttachResult, TerminalHostError>;
  readonly write: (input: {
    readonly sessionId: string;
    readonly data: string;
    readonly generation?: TerminalHostGeneration;
  }) => Effect.Effect<void, TerminalHostError>;
  readonly resize: (input: {
    readonly sessionId: string;
    readonly cols: number;
    readonly rows: number;
    readonly generation?: TerminalHostGeneration;
  }) => Effect.Effect<void, TerminalHostError>;
  readonly getSnapshot: (
    sessionId: string,
  ) => Effect.Effect<TerminalSnapshot | null, TerminalHostError>;
  /** Returns an unsubscribe effect; listener receives monotonic sequenced output. */
  readonly onOutput: (
    sessionId: string,
    listener: (output: TerminalHostOutput) => void,
  ) => Effect.Effect<() => void, TerminalHostError>;
  readonly onExit: (
    sessionId: string,
    listener: (exit: TerminalHostExit) => void,
  ) => Effect.Effect<() => void, TerminalHostError>;
  readonly kill: (sessionId: string) => Effect.Effect<void, TerminalHostError>;
  readonly isAlive: (sessionId: string) => Effect.Effect<boolean>;
  readonly isKilled: (sessionId: string) => Effect.Effect<boolean>;
  readonly generationOf: (sessionId: string) => Effect.Effect<TerminalHostGeneration | null>;
}

export class TerminalHostService extends ServiceMap.Service<
  TerminalHostService,
  TerminalHostServiceShape
>()("agent-group/terminalHost/TerminalHostService") {}

export const TerminalHostServiceLive: Layer.Layer<TerminalHostService, never, PtyAdapter> =
  Layer.effect(TerminalHostService)(
    Effect.gen(function* () {
      const ptyAdapter = yield* PtyAdapter;
      const host = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new TerminalHost({
              // Why runPromise here: PtyAdapter exposes Effect spawn while the
              // host core stays Effect-free; spawn is a rare cold-path call.
              spawnPty: (input) => Effect.runPromise(ptyAdapter.spawn(input)),
            }),
        ),
        (host) => Effect.promise(() => host.dispose()),
      );
      return TerminalHostService.of({
        createOrAttach: (input) =>
          Effect.tryPromise({
            try: () => host.createOrAttach(input),
            catch: toTerminalHostError,
          }),
        attach: (sessionId) =>
          Effect.tryPromise({ try: () => host.attach(sessionId), catch: toTerminalHostError }),
        write: ({ sessionId, data, generation }) =>
          Effect.try({
            try: () => host.write(sessionId, data, generation),
            catch: toTerminalHostError,
          }),
        resize: ({ sessionId, cols, rows, generation }) =>
          Effect.try({
            try: () => host.resize(sessionId, cols, rows, generation),
            catch: toTerminalHostError,
          }),
        getSnapshot: (sessionId) =>
          Effect.tryPromise({ try: () => host.getSnapshot(sessionId), catch: toTerminalHostError }),
        onOutput: (sessionId, listener) =>
          Effect.try({ try: () => host.onOutput(sessionId, listener), catch: toTerminalHostError }),
        onExit: (sessionId, listener) =>
          Effect.try({ try: () => host.onExit(sessionId, listener), catch: toTerminalHostError }),
        kill: (sessionId) =>
          Effect.tryPromise({ try: () => host.kill(sessionId), catch: toTerminalHostError }),
        isAlive: (sessionId) => Effect.sync(() => host.isAlive(sessionId)),
        isKilled: (sessionId) => Effect.sync(() => host.isKilled(sessionId)),
        generationOf: (sessionId) => Effect.sync(() => host.generationOf(sessionId)),
      });
    }),
  );
