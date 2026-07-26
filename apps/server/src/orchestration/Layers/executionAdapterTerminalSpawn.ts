import type { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import type { TerminalHostServiceShape } from "../../terminalHost/TerminalHostService";
import type { TerminalOwnerIdentity } from "../../terminal/terminalProcessIdentity";
import type { ExecutionAdapterAuthorityShape } from "../Services/ExecutionAdapterAuthority";
import {
  ExecutionAdapterError,
  type ExecutionAdapterSpawnSpec,
  type ExecutionAdapterSwitchResult,
} from "../Services/ExecutionAdapterCoordinator";

export function spawnTerminalRuntime(input: {
  readonly terminalHost: TerminalHostServiceShape;
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly threadId: ThreadId;
  readonly revision: number;
  readonly runtimeInstanceId: string;
  readonly spawn: ExecutionAdapterSpawnSpec;
  readonly sessionId: string;
  readonly captureOwnerIdentity: (pid: number) => TerminalOwnerIdentity;
  readonly registerExit: (generation: string) => Effect.Effect<void, ExecutionAdapterError>;
}): Effect.Effect<ExecutionAdapterSwitchResult, ExecutionAdapterError> {
  return Effect.gen(function* () {
    const attached = yield* input.terminalHost
      .createOrAttach({
        sessionId: input.sessionId,
        command: input.spawn.command,
        ...(input.spawn.args !== undefined ? { args: input.spawn.args } : {}),
        cwd: input.spawn.cwd,
        ...(input.spawn.env !== undefined ? { env: input.spawn.env } : {}),
        cols: input.spawn.cols,
        rows: input.spawn.rows,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ExecutionAdapterError({
              reason: "host",
              message: `Terminal host failed to spawn: ${cause.message}`,
              cause,
            }),
        ),
      );
    yield* input.authority
      .updateTerminal({
        threadId: input.threadId,
        revision: input.revision,
        patch: {
          pid: attached.pid,
          ownerIdentity: attached.processGroupIdentity?.leaderIdentity ?? null,
          processGroupIdentity: attached.processGroupIdentity,
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ExecutionAdapterError({
              reason: cause.reason === "stale-revision" ? "stale-revision" : "turn-in-flight",
              message: cause.message,
              cause,
            }),
        ),
      );
    yield* input.registerExit(attached.generation);
    if (!(yield* input.terminalHost.isAlive(input.sessionId))) {
      return yield* Effect.fail(
        new ExecutionAdapterError({
          reason: "host",
          message: `Terminal process exited while thread ${input.threadId} was starting.`,
        }),
      );
    }
    const ownerIdentity = yield* Effect.try({
      try: () =>
        attached.processGroupIdentity?.leaderIdentity ?? input.captureOwnerIdentity(attached.pid),
      catch: (cause) =>
        new ExecutionAdapterError({
          reason: "host",
          message: `Terminal owner identity could not be captured: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        }),
    });
    yield* input.authority
      .completeTerminalStart({
        threadId: input.threadId,
        revision: input.revision,
        generation: attached.generation,
        pid: attached.pid,
        ownerIdentity,
        processGroupIdentity: attached.processGroupIdentity,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ExecutionAdapterError({
              reason:
                cause.reason === "stale-revision"
                  ? "stale-revision"
                  : cause.reason === "stale-generation"
                    ? "stale-generation"
                    : "turn-in-flight",
              message: cause.message,
              cause,
            }),
        ),
      );
    return {
      isNew: attached.isNew,
      revision: input.revision,
      runtimeInstanceId: input.runtimeInstanceId,
      generation: attached.generation,
      pid: attached.pid,
    };
  });
}
