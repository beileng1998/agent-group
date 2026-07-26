// FILE: ExecutionAdapterCoordinator.ts
// Purpose: The single physical runtime switch boundary for structured and
// managed-terminal execution adapters.
// Layer: Server orchestration service implementation

import { type ProviderKind, type ProviderSession, type ThreadId } from "@agent-group/contracts";
import { Effect, Layer, Result } from "effect";
import * as Semaphore from "effect/Semaphore";

import { ProviderService } from "../../provider/Services/ProviderService";
import {
  captureTerminalOwnerIdentity,
  type TerminalOwnerIdentity,
} from "../../terminal/terminalProcessIdentity";
import { TerminalHostService } from "../../terminalHost/TerminalHostService";
import type { TerminalHostServiceShape } from "../../terminalHost/TerminalHostService";
import {
  ExecutionAdapterAuthority,
  ExecutionAdapterAuthorityError,
  type ExecutionAdapterAuthorityShape,
} from "../Services/ExecutionAdapterAuthority";
import {
  ExecutionAdapterCoordinator,
  ExecutionAdapterError,
  type ExecutionAdapterCoordinatorShape,
  type ExecutionAdapterSwitchResult,
} from "../Services/ExecutionAdapterCoordinator";
import {
  suspendProviderRuntime,
  type StructuredRuntimeSuspension,
} from "./executionAdapterProviderSuspension";
import { restartTerminalRuntime, stopTerminalRuntime } from "./executionAdapterTerminalControl";
import { reconcileTerminalExit } from "./executionAdapterTerminalExit";
import { abortTerminalLaunchRuntime } from "./executionAdapterTerminalLaunchAbort";
import { spawnTerminalRuntime } from "./executionAdapterTerminalSpawn";
import { stopStructuredRuntime } from "./executionAdapterStructuredStop";
import { teardownExecutionAdapterForDeletion } from "./executionAdapterThreadDeletion";
import { withTerminalOperationLease } from "./executionAdapterTerminalLease";

/** Host ids are namespaced so managed agents cannot collide with shell tabs. */
export const terminalHostSessionId = (threadId: ThreadId): string => `agent:${threadId}`;

const error = (
  reason: ExecutionAdapterError["reason"],
  message: string,
  cause?: unknown,
): ExecutionAdapterError =>
  new ExecutionAdapterError({
    reason,
    message,
    ...(cause !== undefined ? { cause } : {}),
  });

const fromAuthorityError = (cause: ExecutionAdapterAuthorityError): ExecutionAdapterError => {
  switch (cause.reason) {
    case "not-structured":
      return error("not-structured", cause.message, cause);
    case "not-terminal":
      return error("not-terminal", cause.message, cause);
    case "stale-revision":
      return error("stale-revision", cause.message, cause);
    case "stale-generation":
      return error("stale-generation", cause.message, cause);
    default:
      return error("turn-in-flight", cause.message, cause);
  }
};

const fromUnknown = (
  cause: unknown,
  reason: "host" | "structured-runtime",
  prefix: string,
): ExecutionAdapterError =>
  cause instanceof ExecutionAdapterError
    ? cause
    : error(reason, `${prefix}: ${cause instanceof Error ? cause.message : String(cause)}`, cause);

interface CoordinatorDependencies {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly terminalHost: TerminalHostServiceShape;
  readonly captureOwnerIdentity: (pid: number) => TerminalOwnerIdentity;
  readonly findStructuredRuntime: (
    threadId: ThreadId,
  ) => Effect.Effect<ProviderSession | undefined, unknown>;
  readonly suspendStructuredRuntime: (
    session: ProviderSession,
  ) => Effect.Effect<StructuredRuntimeSuspension, unknown>;
  readonly supportedTerminalProviders: readonly ProviderKind[];
  readonly now: () => string;
}

export function makeExecutionAdapterCoordinator(
  dependencies: CoordinatorDependencies,
): Effect.Effect<ExecutionAdapterCoordinatorShape> {
  return Effect.gen(function* () {
    // Physical transitions span provider and PTY effects. Serializing this
    // cold path makes deletion and compensation deterministic.
    const transitionLock = yield* Semaphore.make(1);
    const withTransition = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
      transitionLock.withPermits(1)(Effect.uninterruptible(operation));

    const authorityEffect = <A>(
      effect: Effect.Effect<A, ExecutionAdapterAuthorityError>,
    ): Effect.Effect<A, ExecutionAdapterError> => effect.pipe(Effect.mapError(fromAuthorityError));

    const registerExit = (
      threadId: ThreadId,
      revision: number,
      generation: string,
    ): Effect.Effect<void, ExecutionAdapterError> =>
      dependencies.terminalHost
        .onExit(terminalHostSessionId(threadId), (exit) => {
          Effect.runFork(
            reconcileTerminalExit({
              authority: dependencies.authority,
              threadId,
              revision,
              generation,
              exitCode: exit.exitCode,
              signal: exit.signal,
            }),
          );
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            error("host", `Terminal exit listener could not attach: ${cause.message}`, cause),
          ),
        );

    const switchToTerminalUnlocked: ExecutionAdapterCoordinatorShape["switchToTerminal"] = (
      input,
    ) =>
      Effect.gen(function* () {
        if (!dependencies.supportedTerminalProviders.includes(input.provider)) {
          return yield* Effect.fail(
            error(
              "unsupported-provider",
              `Provider ${input.provider} has no managed terminal adapter.`,
            ),
          );
        }
        const structured = yield* dependencies
          .findStructuredRuntime(input.threadId)
          .pipe(
            Effect.mapError((cause) =>
              fromUnknown(cause, "structured-runtime", "Structured runtime lookup failed"),
            ),
          );
        if (
          structured?.activeTurnId !== undefined ||
          structured?.status === "running" ||
          structured?.status === "connecting"
        ) {
          return yield* Effect.fail(
            error("turn-in-flight", `Thread ${input.threadId} has a structured turn in flight.`),
          );
        }
        const starting = yield* authorityEffect(
          dependencies.authority.beginTerminalSwitch({
            threadId: input.threadId,
            provider: input.provider,
            runtimeInstanceId: input.runtimeInstanceId,
            providerSessionId: null,
            startedAt: dependencies.now(),
          }),
        );
        let suspension: StructuredRuntimeSuspension | null = null;
        let spawned: ExecutionAdapterSwitchResult | null = null;
        const attempted = yield* Effect.result(
          Effect.gen(function* () {
            if (structured !== undefined && structured.status !== "closed") {
              suspension = yield* dependencies.suspendStructuredRuntime(structured);
            }
            const prepared = yield* input.prepare(suspension?.session ?? structured);
            yield* authorityEffect(
              dependencies.authority.updateTerminal({
                threadId: input.threadId,
                revision: starting.revision,
                patch: {
                  providerSessionId: prepared.providerSessionId,
                },
              }),
            );
            spawned = yield* spawnTerminalRuntime({
              terminalHost: dependencies.terminalHost,
              authority: dependencies.authority,
              threadId: input.threadId,
              revision: starting.revision,
              runtimeInstanceId: input.runtimeInstanceId,
              spawn: prepared.spawn,
              sessionId: terminalHostSessionId(input.threadId),
              captureOwnerIdentity: dependencies.captureOwnerIdentity,
              registerExit: (generation) =>
                registerExit(input.threadId, starting.revision, generation),
            });
            if (suspension !== null) {
              yield* suspension.finalize;
            }
            return spawned;
          }),
        );
        if (Result.isSuccess(attempted)) {
          return attempted.success;
        }
        const compensation = yield* Effect.result(
          Effect.gen(function* () {
            yield* dependencies.terminalHost.kill(terminalHostSessionId(input.threadId));
            const restoring = yield* dependencies.authority.restoreStructured(
              input.threadId,
              starting.revision,
            );
            const resumed =
              suspension === null
                ? Result.succeed(undefined)
                : yield* Effect.result(suspension.resume);
            yield* dependencies.authority.completeStructuredRestore(
              input.threadId,
              restoring.revision,
            );
            if (Result.isFailure(resumed)) {
              return yield* Effect.fail(resumed.failure);
            }
          }),
        );
        if (Result.isFailure(compensation)) {
          return yield* Effect.fail(
            error(
              "compensation-failed",
              `Terminal start failed and structured restoration did not complete: ${
                compensation.failure instanceof Error
                  ? compensation.failure.message
                  : String(compensation.failure)
              }`,
              compensation.failure,
            ),
          );
        }
        return yield* Effect.fail(
          fromUnknown(attempted.failure, "structured-runtime", "Terminal start failed"),
        );
      });

    const switchToTerminal: ExecutionAdapterCoordinatorShape["switchToTerminal"] = (input) =>
      withTransition(switchToTerminalUnlocked(input));

    const restartTerminal: ExecutionAdapterCoordinatorShape["restartTerminal"] = (input) =>
      withTransition(
        dependencies.supportedTerminalProviders.includes(input.provider)
          ? restartTerminalRuntime({
              authority: dependencies.authority,
              terminalHost: dependencies.terminalHost,
              request: input,
              now: dependencies.now,
              sessionId: terminalHostSessionId(input.threadId),
              captureOwnerIdentity: dependencies.captureOwnerIdentity,
              registerExit: (revision, generation) =>
                registerExit(input.threadId, revision, generation),
            })
          : Effect.fail(
              error(
                "unsupported-provider",
                `Provider ${input.provider} has no managed terminal adapter.`,
              ),
            ),
      );

    const stopTerminal: ExecutionAdapterCoordinatorShape["stopTerminal"] = (threadId) =>
      withTransition(
        stopTerminalRuntime({
          authority: dependencies.authority,
          terminalHost: dependencies.terminalHost,
          threadId,
          sessionId: terminalHostSessionId(threadId),
        }),
      );

    const abortTerminalLaunch: ExecutionAdapterCoordinatorShape["abortTerminalLaunch"] = (
      request,
    ) =>
      withTransition(
        abortTerminalLaunchRuntime({
          authority: dependencies.authority,
          terminalHost: dependencies.terminalHost,
          request,
          sessionId: terminalHostSessionId(request.threadId),
        }),
      );

    const stopCurrentAdapter: ExecutionAdapterCoordinatorShape["stopCurrentAdapter"] = (input) =>
      withTransition(
        Effect.gen(function* () {
          const state = yield* dependencies.authority.getState(input.threadId);
          if (state.adapter === "structured") {
            yield* stopStructuredRuntime({
              authority: dependencies.authority,
              threadId: input.threadId,
              stop: input.stopStructured,
            }).pipe(
              Effect.mapError((cause) =>
                cause instanceof ExecutionAdapterAuthorityError
                  ? fromAuthorityError(cause)
                  : fromUnknown(cause, "structured-runtime", "Structured runtime stop failed"),
              ),
            );
            return "structured" as const;
          }
          yield* input
            .beforeTerminalStop()
            .pipe(
              Effect.mapError((cause) => fromUnknown(cause, "host", "Terminal pre-stop failed")),
            );
          yield* stopTerminalRuntime({
            authority: dependencies.authority,
            terminalHost: dependencies.terminalHost,
            threadId: input.threadId,
            sessionId: terminalHostSessionId(input.threadId),
          });
          return "terminal" as const;
        }),
      );

    const switchToStructuredUnlocked: ExecutionAdapterCoordinatorShape["switchToStructured"] = (
      threadId,
    ) =>
      Effect.gen(function* () {
        const stopping = yield* authorityEffect(
          dependencies.authority.beginStructuredSwitch(threadId),
        );
        const killed = yield* Effect.result(
          dependencies.terminalHost.kill(terminalHostSessionId(threadId)),
        );
        if (Result.isFailure(killed)) {
          if (stopping.generation !== null) {
            yield* dependencies.authority
              .updateTerminal({
                threadId,
                revision: stopping.revision,
                generation: stopping.generation,
                patch: {
                  status: "error",
                  error: `Terminal teardown failed: ${
                    killed.failure instanceof Error
                      ? killed.failure.message
                      : String(killed.failure)
                  }`,
                },
              })
              .pipe(Effect.catch(() => Effect.void));
          }
          return yield* Effect.fail(
            fromUnknown(killed.failure, "host", "Terminal teardown failed"),
          );
        }
        const restoring = yield* authorityEffect(
          dependencies.authority.completeStructuredSwitch(threadId, stopping.revision),
        );
        yield* authorityEffect(
          dependencies.authority.completeStructuredRestore(threadId, restoring.revision),
        );
      });

    const switchToStructured: ExecutionAdapterCoordinatorShape["switchToStructured"] = (threadId) =>
      withTransition(switchToStructuredUnlocked(threadId));

    const teardownThread: ExecutionAdapterCoordinatorShape["teardownThread"] = (threadId) =>
      withTransition(
        teardownExecutionAdapterForDeletion({
          authority: dependencies.authority,
          terminalHost: dependencies.terminalHost,
          threadId,
          sessionId: terminalHostSessionId(threadId),
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof ExecutionAdapterAuthorityError
              ? fromAuthorityError(cause)
              : fromUnknown(cause, "host", "Terminal teardown failed"),
          ),
        ),
      );

    const finalizeThreadDeletion: ExecutionAdapterCoordinatorShape["finalizeThreadDeletion"] = (
      threadId,
    ) => withTransition(authorityEffect(dependencies.authority.forgetThread(threadId)));

    return {
      getState: dependencies.authority.getState,
      streamChanges: dependencies.authority.streamChanges,
      isTerminalHostAlive: (threadId) =>
        dependencies.terminalHost.isAlive(terminalHostSessionId(threadId)),
      acquireTerminalOperation: (input) =>
        authorityEffect(
          dependencies.authority.acquireTerminal(
            input.threadId,
            input.revision,
            input.generation,
            input.claimId,
          ),
        ),
      switchToTerminal,
      restartTerminal,
      stopTerminal,
      abortTerminalLaunch,
      stopCurrentAdapter,
      switchToStructured,
      attachClient: (input) =>
        withTerminalOperationLease({
          authority: dependencies.authority,
          ...input,
          operation: "terminal-attach",
          effect: dependencies.terminalHost.attachClient(terminalHostSessionId(input.threadId), {
            onOutput: input.onOutput,
            onExit: input.onExit,
          }),
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof ExecutionAdapterAuthorityError
              ? fromAuthorityError(cause)
              : fromUnknown(cause, "host", "Terminal attach failed"),
          ),
        ),
      write: (input) =>
        withTerminalOperationLease({
          authority: dependencies.authority,
          ...input,
          operation: "terminal-write",
          effect: dependencies.terminalHost.write({
            sessionId: terminalHostSessionId(input.threadId),
            generation: input.generation,
            data: input.data,
          }),
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof ExecutionAdapterAuthorityError
              ? fromAuthorityError(cause)
              : fromUnknown(cause, "host", "Terminal write failed"),
          ),
        ),
      resize: (input) =>
        withTerminalOperationLease({
          authority: dependencies.authority,
          ...input,
          operation: "terminal-resize",
          effect: dependencies.terminalHost.resize({
            sessionId: terminalHostSessionId(input.threadId),
            generation: input.generation,
            cols: input.cols,
            rows: input.rows,
          }),
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof ExecutionAdapterAuthorityError
              ? fromAuthorityError(cause)
              : fromUnknown(cause, "host", "Terminal resize failed"),
          ),
        ),
      updateTerminalState: (input) => authorityEffect(dependencies.authority.updateTerminal(input)),
      teardownThread,
      finalizeThreadDeletion,
    } satisfies ExecutionAdapterCoordinatorShape;
  });
}

const SUPPORTED_TERMINAL_PROVIDERS: readonly ProviderKind[] = ["codex", "claudeAgent", "pi"];

export const ExecutionAdapterCoordinatorLive = Layer.effect(
  ExecutionAdapterCoordinator,
  Effect.gen(function* () {
    const authority = yield* ExecutionAdapterAuthority;
    const terminalHost = yield* TerminalHostService;
    const providerService = yield* ProviderService;
    return yield* makeExecutionAdapterCoordinator({
      authority,
      terminalHost,
      captureOwnerIdentity: (pid) => captureTerminalOwnerIdentity(pid),
      findStructuredRuntime: (threadId) =>
        providerService
          .listSessions()
          .pipe(
            Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)),
          ),
      suspendStructuredRuntime: (session) => suspendProviderRuntime(providerService, session),
      supportedTerminalProviders: SUPPORTED_TERMINAL_PROVIDERS,
      now: () => new Date().toISOString(),
    });
  }),
);
