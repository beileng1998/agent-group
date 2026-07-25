import type { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ExecutionAdapterAuthorityShape } from "../Services/ExecutionAdapterAuthority";

/** Hold a durable structured stop barrier through the physical provider mutation. */
export function stopStructuredRuntime(input: {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly threadId: ThreadId;
  readonly stop: () => Effect.Effect<void, unknown>;
}) {
  return Effect.acquireUseRelease(
    input.authority.beginStructuredStop(input.threadId),
    () =>
      input.authority.awaitClaimsDrained(input.threadId).pipe(
        Effect.andThen(Effect.suspend(input.stop)),
      ),
    (stopping) =>
      input.authority
        .completeStructuredStop(input.threadId, stopping.revision)
        .pipe(Effect.asVoid),
  );
}
