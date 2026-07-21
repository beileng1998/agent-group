import {
  type OrchestrationEvent,
  type OrchestrationThread,
  ProviderKind,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { Cause, Effect, Schema } from "effect";

import type { EnsureProviderSessionOptions } from "./providerSessionCoordinator.ts";
import type { ProviderSessionSelectionState } from "./providerSessionSelectionState.ts";

export type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.created"
      | "thread.meta-updated"
      | "thread.session-set"
      | "thread.runtime-mode-set"
      | "thread.turn-queued"
      | "thread.turn-start-requested"
      | "thread.turn-interrupt-requested"
      | "thread.approval-response-requested"
      | "thread.user-input-response-requested"
      | "thread.conversation-rollback-requested"
      | "thread.message-edit-resend-requested"
      | "thread.session-stop-requested";
  }
>;

const PROVIDER_INTENT_TYPES = new Set<ProviderIntentEvent["type"]>([
  "thread.created",
  "thread.meta-updated",
  "thread.session-set",
  "thread.runtime-mode-set",
  "thread.turn-queued",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.conversation-rollback-requested",
  "thread.message-edit-resend-requested",
  "thread.session-stop-requested",
]);

export function isProviderIntentEvent(event: OrchestrationEvent): event is ProviderIntentEvent {
  return PROVIDER_INTENT_TYPES.has(event.type as ProviderIntentEvent["type"]);
}

type Handler<Type extends ProviderIntentEvent["type"], Environment> = (
  event: Extract<ProviderIntentEvent, { type: Type }>,
) => Effect.Effect<unknown, unknown, Environment>;

/** Routes persisted provider intents and owns spawn-profile projection updates. */
export function makeProviderIntentRouter<Environment>(dependencies: {
  readonly selectionState: ProviderSessionSelectionState;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, unknown, Environment>;
  readonly ensureSessionForThread: (
    threadId: ThreadId,
    createdAt: string,
    options?: EnsureProviderSessionOptions,
  ) => Effect.Effect<unknown, unknown, Environment>;
  readonly hasLiveProviderTurn: (
    threadId: ThreadId,
  ) => Effect.Effect<boolean, unknown, Environment>;
  readonly setThreadSessionError: (input: {
    readonly threadId: ThreadId;
    readonly runtimeMode?: RuntimeMode;
    readonly detail: string;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, unknown, Environment>;
  readonly processTurnQueued: Handler<"thread.turn-queued", Environment>;
  readonly processTurnStartRequested: Handler<"thread.turn-start-requested", Environment>;
  readonly processTurnInterruptRequested: Handler<"thread.turn-interrupt-requested", Environment>;
  readonly processApprovalResponseRequested: Handler<
    "thread.approval-response-requested",
    Environment
  >;
  readonly processUserInputResponseRequested: Handler<
    "thread.user-input-response-requested",
    Environment
  >;
  readonly processConversationRollbackRequested: Handler<
    "thread.conversation-rollback-requested",
    Environment
  >;
  readonly processMessageEditResendRequested: Handler<
    "thread.message-edit-resend-requested",
    Environment
  >;
  readonly processSessionStopRequested: Handler<"thread.session-stop-requested", Environment>;
}) {
  return (event: ProviderIntentEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.session-set": {
          const thread = yield* dependencies.resolveThread(event.payload.threadId);
          if (
            thread &&
            event.payload.session.status !== "stopped" &&
            !dependencies.selectionState.hasModelSelection(event.payload.threadId)
          ) {
            dependencies.selectionState.setModelSelection(
              event.payload.threadId,
              thread.modelSelection,
            );
          }
          return;
        }
        case "thread.created":
          dependencies.selectionState.setModelSelection(
            event.payload.threadId,
            event.payload.modelSelection,
          );
          return;
        case "thread.meta-updated": {
          const thread = yield* dependencies.resolveThread(event.payload.threadId);
          if (event.payload.modelSelection === undefined) return;
          if (!thread?.session || thread.session.status === "stopped") {
            dependencies.selectionState.setModelSelection(
              event.payload.threadId,
              event.payload.modelSelection,
            );
            return;
          }
          const currentProvider = Schema.is(ProviderKind)(thread.session.providerName)
            ? thread.session.providerName
            : thread.modelSelection.provider;
          if (event.payload.modelSelection.provider !== currentProvider) return;
          if (
            thread.session.activeTurnId !== null ||
            (yield* dependencies.hasLiveProviderTurn(event.payload.threadId))
          ) {
            return;
          }
          const cachedProviderOptions = dependencies.selectionState.getProviderOptions(
            event.payload.threadId,
          );
          yield* dependencies.ensureSessionForThread(event.payload.threadId, event.occurredAt, {
            modelSelection: event.payload.modelSelection,
            ...(cachedProviderOptions ? { providerOptions: cachedProviderOptions } : {}),
          });
          dependencies.selectionState.setModelSelection(
            event.payload.threadId,
            event.payload.modelSelection,
          );
          return;
        }
        case "thread.runtime-mode-set": {
          const thread = yield* dependencies.resolveThread(event.payload.threadId);
          if (!thread?.session || thread.session.status === "stopped") return;
          const cachedProviderOptions = dependencies.selectionState.getProviderOptions(
            event.payload.threadId,
          );
          yield* dependencies.ensureSessionForThread(event.payload.threadId, event.occurredAt, {
            ...(cachedProviderOptions ? { providerOptions: cachedProviderOptions } : {}),
            modelSelection: thread.modelSelection,
            runtimeMode: event.payload.runtimeMode,
          });
          return;
        }
        case "thread.turn-queued":
          yield* dependencies.processTurnQueued(event);
          return;
        case "thread.turn-start-requested":
          yield* dependencies.processTurnStartRequested(event);
          return;
        case "thread.turn-interrupt-requested":
          yield* dependencies.processTurnInterruptRequested(event);
          return;
        case "thread.approval-response-requested":
          yield* dependencies.processApprovalResponseRequested(event);
          return;
        case "thread.user-input-response-requested":
          yield* dependencies.processUserInputResponseRequested(event);
          return;
        case "thread.conversation-rollback-requested":
          yield* dependencies.processConversationRollbackRequested(event);
          return;
        case "thread.message-edit-resend-requested":
          yield* dependencies.processMessageEditResendRequested(event).pipe(
            Effect.catchCause((cause) =>
              dependencies.setThreadSessionError({
                threadId: event.payload.threadId,
                runtimeMode: event.payload.runtimeMode,
                detail: Cause.pretty(cause),
                createdAt: event.payload.createdAt,
              }),
            ),
          );
          return;
        case "thread.session-stop-requested":
          yield* dependencies.processSessionStopRequested(event);
          return;
      }
    });
}
