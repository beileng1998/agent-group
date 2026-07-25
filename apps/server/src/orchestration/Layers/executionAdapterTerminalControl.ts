import type { ThreadId } from "@agent-group/contracts";
import { Effect, Result } from "effect";

import type { TerminalHostServiceShape } from "../../terminalHost/TerminalHostService";
import type { TerminalOwnerIdentity } from "../../terminal/terminalProcessIdentity";
import type {
  ExecutionAdapterAuthorityError,
  ExecutionAdapterAuthorityShape,
} from "../Services/ExecutionAdapterAuthority";
import {
  ExecutionAdapterError,
  type ExecutionAdapterCoordinatorShape,
} from "../Services/ExecutionAdapterCoordinator";
import { spawnTerminalRuntime } from "./executionAdapterTerminalSpawn";

const failure = (
  reason: ExecutionAdapterError["reason"],
  message: string,
  cause?: unknown,
) =>
  new ExecutionAdapterError({
    reason,
    message,
    ...(cause !== undefined ? { cause } : {}),
  });

const mapAuthority = <A>(
  effect: Effect.Effect<A, ExecutionAdapterAuthorityError>,
): Effect.Effect<A, ExecutionAdapterError> =>
  effect.pipe(
    Effect.mapError((cause: { readonly reason?: string; readonly message?: string }) =>
      failure(
        cause.reason === "not-terminal"
          ? "not-terminal"
          : cause.reason === "stale-revision"
            ? "stale-revision"
            : cause.reason === "stale-generation"
              ? "stale-generation"
              : "turn-in-flight",
        cause.message ?? "Execution adapter authority rejected the operation.",
        cause,
      ),
    ),
  ) as Effect.Effect<A, ExecutionAdapterError>;

export function restartTerminalRuntime(input: {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly terminalHost: TerminalHostServiceShape;
  readonly request: Parameters<ExecutionAdapterCoordinatorShape["restartTerminal"]>[0];
  readonly now: () => string;
  readonly sessionId: string;
  readonly captureOwnerIdentity: (pid: number) => TerminalOwnerIdentity;
  readonly registerExit: (
    revision: number,
    generation: string,
  ) => Effect.Effect<void, ExecutionAdapterError>;
}) {
  const request = input.request;
  return Effect.gen(function* () {
    const current = yield* input.authority.getState(request.threadId);
    if (current.adapter !== "terminal" || current.provider !== request.provider) {
      return yield* Effect.fail(
        failure("not-terminal", `Thread ${request.threadId} is not using this Terminal.`),
      );
    }
    if (current.activeTurnId !== null || current.status === "running") {
      return yield* Effect.fail(
        failure("turn-in-flight", `Thread ${request.threadId} has a terminal turn in flight.`),
      );
    }
    if (current.status !== "stopping") {
      yield* mapAuthority(input.authority.beginTerminalStop(request.threadId));
    }
    const killed = yield* Effect.result(input.terminalHost.kill(input.sessionId));
    if (Result.isFailure(killed)) {
      const failedState = yield* input.authority.getState(request.threadId);
      yield* input.authority
        .updateTerminal({
          threadId: request.threadId,
          revision: failedState.revision,
          ...(failedState.adapter === "terminal" &&
          failedState.generation !== null
            ? { generation: failedState.generation }
            : {}),
          patch: {
            status: "error",
            error: `Terminal teardown failed: ${killed.failure.message}`,
          },
        })
        .pipe(Effect.catch(() => Effect.void));
      return yield* Effect.fail(
        failure(
          "host",
          `Terminal teardown failed: ${killed.failure.message}`,
          killed.failure,
        ),
      );
    }
    const starting = yield* mapAuthority(
      input.authority.beginTerminalRestart({
        threadId: request.threadId,
        runtimeInstanceId: request.runtimeInstanceId,
        providerSessionId: request.providerSessionId ?? current.providerSessionId,
        startedAt: input.now(),
      }),
    );
    const attempted = yield* Effect.result(
      spawnTerminalRuntime({
        terminalHost: input.terminalHost,
        authority: input.authority,
        threadId: request.threadId,
        revision: starting.revision,
        runtimeInstanceId: request.runtimeInstanceId,
        spawn: request.spawn,
        sessionId: input.sessionId,
        captureOwnerIdentity: input.captureOwnerIdentity,
        registerExit: (generation) => input.registerExit(starting.revision, generation),
      }),
    );
    if (Result.isSuccess(attempted)) return attempted.success;
    yield* input.terminalHost.kill(input.sessionId).pipe(Effect.catch(() => Effect.void));
    yield* input.authority
      .updateTerminal({
        threadId: request.threadId,
        revision: starting.revision,
        patch: {
          status: "error",
          error:
            attempted.failure instanceof Error
              ? attempted.failure.message
              : String(attempted.failure),
        },
      })
      .pipe(Effect.catch(() => Effect.void));
    return yield* Effect.fail(
      attempted.failure instanceof ExecutionAdapterError
        ? attempted.failure
        : failure("host", "Terminal restart failed.", attempted.failure),
    );
  });
}

export function stopTerminalRuntime(input: {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly terminalHost: TerminalHostServiceShape;
  readonly threadId: ThreadId;
  readonly sessionId: string;
}) {
  return Effect.gen(function* () {
    const stopping = yield* mapAuthority(
      input.authority.beginTerminalStop(input.threadId),
    );
    const killed = yield* Effect.result(input.terminalHost.kill(input.sessionId));
    if (Result.isFailure(killed)) {
      yield* input.authority
        .updateTerminal({
          threadId: input.threadId,
          revision: stopping.revision,
          ...(stopping.generation !== null
            ? { generation: stopping.generation }
            : {}),
          patch: {
            status: "error",
            error: `Terminal teardown failed: ${killed.failure.message}`,
          },
        })
        .pipe(Effect.catch(() => Effect.void));
      return yield* Effect.fail(
        failure(
          "host",
          `Terminal teardown failed: ${killed.failure.message}`,
          killed.failure,
        ),
      );
    }
    yield* mapAuthority(
      input.authority.updateTerminal({
        threadId: input.threadId,
        revision: stopping.revision,
        ...(stopping.generation !== null
          ? { generation: stopping.generation }
          : {}),
        patch: {
          status: "stopped",
          pid: null,
          ownerIdentity: null,
          processGroupIdentity: null,
          activeTurnId: null,
          exitCode: null,
          exitSignal: null,
          error: null,
        },
      }),
    );
  });
}
