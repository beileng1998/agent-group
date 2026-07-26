import type { ThreadId } from "@agent-group/contracts";
import { Effect, Ref } from "effect";
import type * as Semaphore from "effect/Semaphore";

import type {
  ExecutionAdapterAuthorityError,
  ExecutionAdapterAuthorityShape,
  ExecutionAdapterAuthorityState,
} from "../Services/ExecutionAdapterAuthority";
import { pruneExecutionAdapterClaims } from "./executionAdapterAuthorityClaims";
import type { ExecutionAdapterAuthorityRuntimeState } from "./executionAdapterAuthorityState";
import { makeExecutionAdapterAuthorityError as authorityError } from "./executionAdapterAuthorityState";

export function makeExecutionAdapterAuthorityForget(input: {
  readonly runtime: Ref.Ref<ExecutionAdapterAuthorityRuntimeState>;
  readonly transactionLock: Semaphore.Semaphore;
  readonly persist: (
    states: ReadonlyMap<ThreadId, ExecutionAdapterAuthorityState>,
  ) => Effect.Effect<void, unknown>;
  readonly now: () => Date;
  readonly unavailableError: () => ExecutionAdapterAuthorityError;
  readonly unavailable: boolean;
}): ExecutionAdapterAuthorityShape["forgetThread"] {
  return (threadId) =>
    input.unavailable
      ? Effect.fail(input.unavailableError())
      : input.transactionLock.withPermits(1)(
          Effect.uninterruptible(
            Effect.gen(function* () {
              const current = yield* Ref.get(input.runtime);
              const claims = pruneExecutionAdapterClaims(current.claims, input.now().getTime());
              const state = current.states.get(threadId);
              if (state?.adapter !== "structured" || state.status !== "deleting") {
                return yield* Effect.fail(
                  authorityError(
                    "transition-in-progress",
                    `Thread ${threadId} has no completed deletion tombstone.`,
                  ),
                );
              }
              if ((claims.get(threadId)?.size ?? 0) > 0) {
                return yield* Effect.fail(
                  authorityError(
                    "structured-operation-active",
                    `Thread ${threadId} still has an execution-adapter operation in flight.`,
                  ),
                );
              }
              const states = new Map(current.states);
              states.delete(threadId);
              yield* input
                .persist(states)
                .pipe(
                  Effect.mapError(() =>
                    authorityError(
                      "persistence-failed",
                      "Execution adapter authority could not forget the deleted Thread.",
                    ),
                  ),
                );
              const nextClaims = new Map(claims);
              nextClaims.delete(threadId);
              yield* Ref.set(input.runtime, { states, claims: nextClaims });
            }),
          ),
        );
}
