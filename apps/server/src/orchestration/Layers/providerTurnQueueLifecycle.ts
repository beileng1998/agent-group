import { type CommandId, type OrchestrationCommand, type ThreadId } from "@agent-group/contracts";
import { Effect, Exit } from "effect";

import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import type { ExecutionAdapterAuthorityShape } from "../Services/ExecutionAdapterAuthority.ts";
import type { ProviderTurnQueue } from "./providerTurnQueue.ts";

type DispatchQueuedTurnCommand = Extract<
  OrchestrationCommand,
  { type: "thread.turn.dispatch-queued" }
>;

export function releaseCanceledProviderTurnClaims(input: {
  readonly turnQueue: ProviderTurnQueue;
  readonly releaseStructured: ExecutionAdapterAuthorityShape["releaseStructured"];
}) {
  return Effect.suspend(() =>
    Effect.forEach(
      input.turnQueue.takeCanceledClaims(),
      (claim) => input.releaseStructured(claim.threadId, claim.claimId),
      { discard: true },
    ),
  );
}

export function withCanceledProviderTurnClaimCleanup<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  input: {
    readonly turnQueue: ProviderTurnQueue;
    readonly releaseStructured: ExecutionAdapterAuthorityShape["releaseStructured"];
  },
): Effect.Effect<A, E, R> {
  return effect.pipe(Effect.ensuring(releaseCanceledProviderTurnClaims(input)));
}

/** Promotes one queued turn while continuously transferring its authority claim. */
export function makeProviderTurnQueueDrain(input: {
  readonly turnQueue: ProviderTurnQueue;
  readonly orchestrationEngine: Pick<OrchestrationEngineShape, "dispatch">;
  readonly releaseStructured: ExecutionAdapterAuthorityShape["releaseStructured"];
  readonly serverCommandId: (tag: string) => CommandId;
}) {
  return Effect.fnUntraced(function* (threadId: ThreadId) {
    if (!input.turnQueue.tryBeginDrain(threadId)) return;
    yield* Effect.gen(function* () {
      const queued = input.turnQueue.dequeue(threadId);
      if (!queued) return;
      input.turnQueue.markDispatchPending(threadId);
      const payload = queued.payload;
      const command: DispatchQueuedTurnCommand = {
        type: "thread.turn.dispatch-queued",
        commandId: input.serverCommandId("dispatch-queued-turn"),
        threadId,
        messageId: payload.messageId,
        ...(payload.modelSelection !== undefined ? { modelSelection: payload.modelSelection } : {}),
        ...(payload.providerOptions !== undefined
          ? { providerOptions: payload.providerOptions }
          : {}),
        ...(payload.reviewTarget !== undefined ? { reviewTarget: payload.reviewTarget } : {}),
        ...(payload.assistantDeliveryMode !== undefined
          ? { assistantDeliveryMode: payload.assistantDeliveryMode }
          : {}),
        dispatchMode: payload.dispatchMode,
        runtimeMode: payload.runtimeMode,
        interactionMode: payload.interactionMode,
        ...(payload.sourceProposedPlan !== undefined
          ? { sourceProposedPlan: payload.sourceProposedPlan }
          : {}),
        createdAt: payload.createdAt,
      };
      yield* input.orchestrationEngine.dispatch(command).pipe(
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? input.releaseStructured(queued.claim.threadId, queued.claim.claimId)
            : Effect.sync(() => {
                input.turnQueue.clearDispatchPending(threadId);
                input.turnQueue.requeueFront(queued);
              }),
        ),
      );
    }).pipe(Effect.ensuring(Effect.sync(() => input.turnQueue.finishDrain(threadId))));
  });
}
