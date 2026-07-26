import type { ThreadId } from "@agent-group/contracts";
import { Effect, Result } from "effect";

import type {
  ExecutionAdapterAuthorityError,
  ExecutionAdapterAuthorityShape,
} from "../Services/ExecutionAdapterAuthority.ts";

/**
 * Fences asynchronous structured-runtime side effects against adapter changes.
 * Late provider events are intentionally ignored once a thread stops being
 * structured-owned.
 */
export function withStructuredRuntimeLease<A, E, R>(input: {
  readonly authority: Pick<ExecutionAdapterAuthorityShape, "acquireStructured">;
  readonly threadId: ThreadId;
  readonly operation: string;
  readonly effect: Effect.Effect<A, E, R>;
}): Effect.Effect<A | void, E | ExecutionAdapterAuthorityError, R> {
  return Effect.gen(function* () {
    const acquired = yield* Effect.result(
      input.authority.acquireStructured(
        input.threadId,
        `${input.operation}:${crypto.randomUUID()}`,
      ),
    );
    if (Result.isFailure(acquired)) {
      if (
        acquired.failure.reason === "not-structured" ||
        acquired.failure.reason === "transition-in-progress"
      ) {
        return;
      }
      return yield* Effect.fail(acquired.failure);
    }
    return yield* input.effect.pipe(Effect.ensuring(acquired.success.release));
  });
}
