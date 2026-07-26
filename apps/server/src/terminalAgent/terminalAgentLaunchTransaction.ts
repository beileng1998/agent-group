import { Effect } from "effect";

/**
 * Physical launch spans bridge registration, authority persistence, and PTY
 * spawn. Once entered it must settle before its caller can release the
 * per-Thread operation lock, even when the requesting RPC is interrupted.
 */
export function runTerminalAgentLaunchTransaction<A, E>(
  launch: () => Promise<A>,
  mapError: (cause: unknown) => E,
): Effect.Effect<A, E> {
  return Effect.uninterruptible(
    Effect.tryPromise({
      try: launch,
      catch: mapError,
    }),
  );
}
