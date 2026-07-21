import { type MessageId, type ThreadId } from "@agent-group/contracts";
import { Cache, Effect, Option } from "effect";

import type { ProviderRuntimeBufferState } from "./providerRuntimeBufferState.ts";

export function makeProviderRuntimeSessionCleanup(input: {
  readonly state: ProviderRuntimeBufferState;
  readonly clearAssistantMessageState: (messageId: MessageId) => Effect.Effect<void>;
}) {
  const clearTurnStateForSession = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const prefix = `${threadId}:`;
      const planPrefix = `plan:${threadId}:`;
      const turnKeys = Array.from(yield* Cache.keys(input.state.turnMessageIdsByTurnKey));
      const planKeys = Array.from(yield* Cache.keys(input.state.bufferedProposedPlanById));
      const imageKeys = Array.from(yield* Cache.keys(input.state.pendingGeneratedImagesByTurnKey));
      yield* Effect.forEach(
        turnKeys,
        (key) =>
          Effect.gen(function* () {
            if (!key.startsWith(prefix)) return;
            const messageIds = yield* Cache.getOption(input.state.turnMessageIdsByTurnKey, key);
            if (Option.isSome(messageIds)) {
              yield* Effect.forEach(
                messageIds.value,
                (messageId) => input.clearAssistantMessageState(messageId),
                { concurrency: 1 },
              ).pipe(Effect.asVoid);
            }
            yield* Cache.invalidate(input.state.turnMessageIdsByTurnKey, key);
          }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        planKeys,
        (key) =>
          key.startsWith(planPrefix)
            ? Cache.invalidate(input.state.bufferedProposedPlanById, key)
            : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        imageKeys,
        (key) =>
          key.startsWith(prefix)
            ? Cache.invalidate(input.state.pendingGeneratedImagesByTurnKey, key)
            : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
    });
  return { clearTurnStateForSession };
}
