import { Effect, Result } from "effect";

import type { TerminalHostServiceShape } from "../../terminalHost/TerminalHostService";
import type {
  ExecutionAdapterAuthorityError,
  ExecutionAdapterAuthorityShape,
} from "../Services/ExecutionAdapterAuthority";
import {
  ExecutionAdapterError,
  type ExecutionAdapterCoordinatorShape,
} from "../Services/ExecutionAdapterCoordinator";
import { stopTerminalRuntime } from "./executionAdapterTerminalControl";

const authorityError = (cause: ExecutionAdapterAuthorityError) =>
  new ExecutionAdapterError({
    reason:
      cause.reason === "not-terminal"
        ? "not-terminal"
        : cause.reason === "stale-revision"
          ? "stale-revision"
          : cause.reason === "stale-generation"
            ? "stale-generation"
            : "turn-in-flight",
    message: cause.message,
    cause,
  });

const hostError = (message: string, cause: unknown) =>
  new ExecutionAdapterError({ reason: "host", message, cause });

/** Compensate a post-spawn launch failure without creating a deletion tombstone. */
export function abortTerminalLaunchRuntime(input: {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly terminalHost: TerminalHostServiceShape;
  readonly request: Parameters<ExecutionAdapterCoordinatorShape["abortTerminalLaunch"]>[0];
  readonly sessionId: string;
}) {
  const request = input.request;
  return Effect.gen(function* () {
    const current = yield* input.authority.getState(request.threadId);
    if (current.adapter !== "terminal") {
      return yield* Effect.fail(
        new ExecutionAdapterError({
          reason: "not-terminal",
          message: `Thread ${request.threadId} is no longer terminal-owned.`,
        }),
      );
    }
    if (current.revision !== request.revision) {
      return yield* Effect.fail(
        new ExecutionAdapterError({
          reason: "stale-revision",
          message: `Terminal revision ${request.revision} is stale.`,
        }),
      );
    }
    if (current.generation !== request.generation) {
      return yield* Effect.fail(
        new ExecutionAdapterError({
          reason: "stale-generation",
          message: "Terminal generation is stale.",
        }),
      );
    }
    if (request.restoreStructured === false) {
      return yield* stopTerminalRuntime({
        authority: input.authority,
        terminalHost: input.terminalHost,
        threadId: request.threadId,
        sessionId: input.sessionId,
      });
    }

    const stopping = yield* input.authority
      .beginStructuredSwitch(request.threadId)
      .pipe(Effect.mapError(authorityError));
    const killed = yield* Effect.result(input.terminalHost.kill(input.sessionId));
    if (Result.isFailure(killed)) {
      yield* input.authority
        .updateTerminal({
          threadId: request.threadId,
          revision: stopping.revision,
          generation: request.generation,
          patch: {
            status: "error",
            error: `Terminal launch cleanup failed: ${killed.failure.message}`,
          },
        })
        .pipe(Effect.catch(() => Effect.void));
      return yield* Effect.fail(
        hostError(`Terminal launch cleanup failed: ${killed.failure.message}`, killed.failure),
      );
    }
    const restoring = yield* input.authority
      .completeStructuredSwitch(request.threadId, stopping.revision)
      .pipe(Effect.mapError(authorityError));
    yield* input.authority
      .completeStructuredRestore(request.threadId, restoring.revision)
      .pipe(Effect.mapError(authorityError));
  });
}
