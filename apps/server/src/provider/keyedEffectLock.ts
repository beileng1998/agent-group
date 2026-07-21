import { Effect } from "effect";
import * as Semaphore from "effect/Semaphore";

/** Creates an interrupt-safe mutex per key and releases unused lock entries. */
export function makeKeyedEffectLock<Key>() {
  const entries = new Map<Key, { readonly semaphore: Semaphore.Semaphore; users: number }>();

  return <A, E, R>(key: Key, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
        entries.set(key, entry);
      }
      entry.users += 1;
      const acquiredEntry = entry;

      return acquiredEntry.semaphore
        .withPermits(1)(effect)
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              acquiredEntry.users -= 1;
              if (acquiredEntry.users === 0 && entries.get(key) === acquiredEntry) {
                entries.delete(key);
              }
            }),
          ),
        );
    });
}
