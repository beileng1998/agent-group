import { Cause, Effect } from "effect";

import type { ExecutionAdapterAuthorityShape } from "../Services/ExecutionAdapterAuthority.ts";
import type { ProviderIntentEvent } from "./providerIntentRouter.ts";
import type { ProviderQueueDrainEvent } from "./providerTurnBootstrapState.ts";
import type { ProviderTurnQueue } from "./providerTurnQueue.ts";
import { withCanceledProviderTurnClaimCleanup } from "./providerTurnQueueLifecycle.ts";

export function makeProviderReactorEventSafety<Environment>(input: {
  readonly turnQueue: ProviderTurnQueue;
  readonly releaseStructured: ExecutionAdapterAuthorityShape["releaseStructured"];
  readonly processDomainEvent: (
    event: ProviderIntentEvent,
  ) => Effect.Effect<unknown, unknown, Environment>;
  readonly processQueueDrainEvent: (
    event: ProviderQueueDrainEvent,
  ) => Effect.Effect<unknown, unknown, Environment>;
}) {
  const processDomainEventSafely = (event: ProviderIntentEvent) =>
    withCanceledProviderTurnClaimCleanup(
      input.processDomainEvent(event).pipe(
        Effect.timeout("120 seconds"),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("provider command reactor failed to process event", {
                eventType: event.type,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
      input,
    );

  const processQueueDrainEventSafely = (event: ProviderQueueDrainEvent) =>
    input.processQueueDrainEvent(event).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("provider command reactor failed to drain queued turn", {
              eventType: event.type,
              threadId: event.threadId,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  return { processDomainEventSafely, processQueueDrainEventSafely };
}
