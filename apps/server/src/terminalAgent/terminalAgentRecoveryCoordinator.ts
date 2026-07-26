// FILE: terminalAgentRecoveryCoordinator.ts
// Purpose: Reconcile every durable adapter state without blocking server boot.
// Layer: Managed terminal service recovery

import type { ServerSettings, ThreadId } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import type {
  StructuredAuthorityState,
  TerminalAuthorityState,
} from "../orchestration/Services/ExecutionAdapterAuthority";
import type { TerminalAgentOperationLocks } from "./terminalAgentOperationLocks";

const RECOVERY_CONCURRENCY = 4;
const RECOVERY_STATE_TIMEOUT_MS = 30_000;
const RECOVERY_TOTAL_TIMEOUT_MS = 120_000;

export function recoverTerminalAgentAuthorities(input: {
  readonly getSettings: Effect.Effect<ServerSettings, unknown>;
  readonly listStates: Effect.Effect<
    ReadonlyMap<ThreadId, StructuredAuthorityState | TerminalAuthorityState>,
    unknown
  >;
  readonly withThread: TerminalAgentOperationLocks["withThread"];
  readonly recoverTerminal: (
    threadId: ThreadId,
    state: TerminalAuthorityState,
    settings: ServerSettings,
  ) => Effect.Effect<void, unknown>;
  readonly recoverStructured: (
    threadId: ThreadId,
    state: StructuredAuthorityState,
  ) => Effect.Effect<void, unknown>;
  readonly onRecoveryFailure: (
    threadId: ThreadId,
    state: StructuredAuthorityState | TerminalAuthorityState,
    reason: string,
  ) => Effect.Effect<void, unknown>;
  readonly stateTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    const settings = yield* input.getSettings.pipe(
      Effect.catch((cause) =>
        Effect.logWarning("managed terminal recovery skipped: settings unavailable", {
          cause,
        }).pipe(Effect.as(null)),
      ),
    );
    if (settings === null) return;
    const states = yield* input.listStates.pipe(
      Effect.catch((cause) =>
        Effect.logWarning("managed terminal recovery skipped: authority unavailable", {
          cause,
        }).pipe(Effect.as(new Map())),
      ),
    );
    const stateTimeoutMs = input.stateTimeoutMs ?? RECOVERY_STATE_TIMEOUT_MS;
    const settled = new Set<ThreadId>();
    const recovered = yield* Effect.forEach(
      [...states],
      ([threadId, state]) =>
        input
          .withThread(
            threadId,
            state.adapter === "terminal"
              ? input.recoverTerminal(threadId, state, settings)
              : input.recoverStructured(threadId, state),
          )
          .pipe(
            Effect.timeoutOption(stateTimeoutMs),
            Effect.flatMap((result) =>
              Option.isSome(result)
                ? Effect.void
                : input
                    .onRecoveryFailure(threadId, state, "Agent Terminal recovery timed out.")
                    .pipe(
                      Effect.catch((cause) =>
                        Effect.logWarning("managed terminal recovery timeout could not persist", {
                          threadId,
                          cause,
                        }),
                      ),
                    ),
            ),
            Effect.catch((cause) =>
              input
                .onRecoveryFailure(
                  threadId,
                  state,
                  `Agent Terminal recovery failed: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`,
                )
                .pipe(
                  Effect.catch((persistCause) =>
                    Effect.logWarning("managed terminal recovery failure could not persist", {
                      threadId,
                      cause,
                      persistCause,
                    }),
                  ),
                ),
            ),
            Effect.tap(() =>
              Effect.sync(() => {
                settled.add(threadId);
              }),
            ),
          ),
      { concurrency: RECOVERY_CONCURRENCY },
    ).pipe(Effect.timeoutOption(input.totalTimeoutMs ?? RECOVERY_TOTAL_TIMEOUT_MS));
    if (Option.isNone(recovered)) {
      yield* Effect.logWarning("managed terminal recovery reached its total time limit");
      yield* Effect.forEach(
        [...states].filter(([threadId]) => !settled.has(threadId)),
        ([threadId, state]) =>
          input
            .onRecoveryFailure(
              threadId,
              state,
              "Agent Terminal recovery exceeded the startup time limit.",
            )
            .pipe(
              Effect.catch((cause) =>
                Effect.logWarning("managed terminal total-timeout state could not persist", {
                  threadId,
                  cause,
                }),
              ),
            ),
        { concurrency: RECOVERY_CONCURRENCY },
      ).pipe(Effect.timeoutOption(Math.min(stateTimeoutMs, 5_000)), Effect.asVoid);
    }
  });
}
