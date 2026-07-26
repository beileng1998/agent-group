import type { ThreadId } from "@agent-group/contracts";
import { Cache, Duration, Effect, Option } from "effect";

import { ExecutionAdapterAuthority } from "../Services/ExecutionAdapterAuthority.ts";

const HANDLED_TURN_START_KEY_MAX = 10_000;
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);

/** Authority bindings and replay deduplication shared by provider turn admission. */
export const makeProviderReactorAuthority = Effect.gen(function* () {
  const authority = yield* ExecutionAdapterAuthority;
  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });

  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const claimStructuredStart = (threadId: ThreadId, claimId: string) =>
    authority
      .claimStructuredStart(threadId, claimId)
      .pipe(
        Effect.catch((error) =>
          error.reason === "claim-missing"
            ? authority.acquireStructured(threadId, claimId)
            : Effect.fail(error),
        ),
      );

  return {
    acquireStructured: authority.acquireStructured,
    claimStructuredStart,
    getState: authority.getState,
    hasHandledTurnStartRecently,
    releaseStructured: authority.releaseStructured,
  } as const;
});
