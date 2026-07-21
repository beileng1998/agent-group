import type { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ProviderServiceError } from "../../provider/Errors.ts";
import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";

/** Clears a stale native resume cursor without changing projected thread state. */
export function makeProviderResumeRecovery(providerService: ProviderServiceShape) {
  return Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly cause: ProviderServiceError;
  }) {
    if (providerService.clearSessionResumeCursor) {
      yield* providerService
        .clearSessionResumeCursor({ threadId: input.threadId })
        .pipe(Effect.catch(() => Effect.void));
    } else {
      yield* providerService
        .stopSession({ threadId: input.threadId })
        .pipe(Effect.catch(() => Effect.void));
    }
    yield* Effect.logWarning("provider command reactor cleared stale provider resume state", {
      threadId: input.threadId,
      cause: input.cause.message,
    });
  });
}
