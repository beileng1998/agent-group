import type { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";
import * as Semaphore from "effect/Semaphore";

export interface TerminalAgentOperationLocks {
  readonly withThread: <A, E, R>(
    threadId: ThreadId,
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export const makeTerminalAgentOperationLocks: Effect.Effect<TerminalAgentOperationLocks> =
  Effect.gen(function* () {
    const registryLock = yield* Semaphore.make(1);
    const locks = new Map<ThreadId, Semaphore.Semaphore>();
    const lockFor = (threadId: ThreadId) =>
      registryLock.withPermits(1)(
        Effect.gen(function* () {
          const existing = locks.get(threadId);
          if (existing) return existing;
          const created = yield* Semaphore.make(1);
          locks.set(threadId, created);
          return created;
        }),
      );
    return {
      withThread: (threadId, operation) =>
        lockFor(threadId).pipe(Effect.flatMap((lock) => lock.withPermits(1)(operation))),
    };
  });
