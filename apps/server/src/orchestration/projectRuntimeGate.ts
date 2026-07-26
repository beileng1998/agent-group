import { Effect } from "effect";
import * as Semaphore from "effect/Semaphore";

const entries = new Map<string, { readonly semaphore: Semaphore.Semaphore; users: number }>();

/**
 * Serializes project-root mutations with runtime launches. The module singleton
 * is shared by orchestration command dispatch and Terminal Agent launch.
 */
export function withProjectRuntimeGate<A, E, R>(
  projectId: string,
  operation: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    let entry = entries.get(projectId);
    if (!entry) {
      entry = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
      entries.set(projectId, entry);
    }
    entry.users += 1;
    const acquired = entry;
    return acquired.semaphore
      .withPermits(1)(operation)
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            acquired.users -= 1;
            if (acquired.users === 0 && entries.get(projectId) === acquired) {
              entries.delete(projectId);
            }
          }),
        ),
      );
  });
}
