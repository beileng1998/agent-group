import { Cause, Effect, Exit, Option } from "effect";

export type BoundedProviderControlResult<A> =
  | { readonly _tag: "completed"; readonly value: A }
  | { readonly _tag: "timeout"; readonly detail: string }
  | { readonly _tag: "failed"; readonly detail: string };

/** Bounds a control-plane call while preserving external interruption for shutdown. */
export function runBoundedProviderControl<A, E, R>(input: {
  readonly label: string;
  readonly timeoutMs: number;
  readonly effect: Effect.Effect<A, E, R>;
}): Effect.Effect<BoundedProviderControlResult<A>, E, R> {
  return input.effect.pipe(
    Effect.timeoutOption(input.timeoutMs),
    Effect.exit,
    Effect.flatMap((exit) => {
      if (Exit.isSuccess(exit)) {
        return Effect.succeed(
          Option.match(exit.value, {
            onNone: (): BoundedProviderControlResult<A> => ({
              _tag: "timeout",
              detail: `${input.label} did not respond within ${input.timeoutMs}ms.`,
            }),
            onSome: (value): BoundedProviderControlResult<A> => ({
              _tag: "completed",
              value,
            }),
          }),
        );
      }
      if (Cause.hasInterruptsOnly(exit.cause)) return Effect.failCause(exit.cause);
      return Effect.succeed({
        _tag: "failed" as const,
        detail: Cause.pretty(exit.cause),
      });
    }),
  );
}
