import {
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  type TurnId,
} from "@agent-group/contracts";
import { Cause, Effect } from "effect";

import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type { makeProviderRuntimePlans } from "./providerRuntimePlans.ts";
import {
  orchestrationSessionStatusFromRuntimeState,
  providerCommandId,
  resolveTerminalTurnId,
  runtimeTurnErrorMessage,
  runtimeTurnState,
  sameId,
  STRICT_PROVIDER_LIFECYCLE_GUARD,
} from "./providerRuntimeIngestionValues.ts";

type Plans = ReturnType<typeof makeProviderRuntimePlans>;

export interface RuntimeLifecycleResolution {
  readonly activeTurnId: TurnId | null;
  readonly eventTurnId: TurnId | undefined;
  readonly isTerminalTurnEvent: boolean;
  readonly shouldApplyThreadLifecycle: boolean;
}

export function makeProviderRuntimeLifecycle(input: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly plans: Plans;
}) {
  const applyLifecycle = (event: ProviderRuntimeEvent, thread: OrchestrationThread) =>
    Effect.gen(function* () {
      const activeTurnId = thread.session?.activeTurnId ?? null;
      const eventTurnId = resolveTerminalTurnId(event, activeTurnId);
      const isTerminalTurnEvent = event.type === "turn.completed" || event.type === "turn.aborted";
      const conflictsWithActiveTurn =
        activeTurnId !== null && eventTurnId !== undefined && !sameId(activeTurnId, eventTurnId);
      const missingTurnForActiveTurn = activeTurnId !== null && eventTurnId === undefined;
      const shouldApplyThreadLifecycle = (() => {
        if (!STRICT_PROVIDER_LIFECYCLE_GUARD) return true;
        switch (event.type) {
          case "session.exited":
          case "session.started":
          case "thread.started":
            return true;
          case "turn.started":
            return !conflictsWithActiveTurn;
          case "turn.completed":
          case "turn.aborted":
            if (conflictsWithActiveTurn || missingTurnForActiveTurn) return false;
            if (activeTurnId !== null && eventTurnId !== undefined) {
              return sameId(activeTurnId, eventTurnId);
            }
            return true;
          default:
            return true;
        }
      })();

      const acceptedSourcePlan =
        event.type === "turn.started" && shouldApplyThreadLifecycle
          ? yield* input.plans.getSourceProposedPlanReferenceForAcceptedTurnStart(
              thread.id,
              eventTurnId,
            )
          : null;

      if (
        event.type === "session.started" ||
        event.type === "session.state.changed" ||
        event.type === "session.exited" ||
        event.type === "thread.started" ||
        event.type === "turn.started" ||
        event.type === "turn.completed" ||
        event.type === "turn.aborted"
      ) {
        const nextActiveTurnId =
          event.type === "turn.started"
            ? (eventTurnId ?? null)
            : isTerminalTurnEvent ||
                event.type === "session.exited" ||
                (event.type === "session.state.changed" &&
                  (event.payload.state === "ready" ||
                    event.payload.state === "stopped" ||
                    event.payload.state === "error"))
              ? null
              : activeTurnId;
        const status = (() => {
          switch (event.type) {
            case "session.state.changed":
              return orchestrationSessionStatusFromRuntimeState(event.payload.state);
            case "turn.started":
              return "running" as const;
            case "session.exited":
              return "stopped" as const;
            case "turn.completed":
              return runtimeTurnState(event) === "failed" ? ("error" as const) : ("ready" as const);
            case "turn.aborted":
              return "interrupted" as const;
            case "session.started":
            case "thread.started":
              return activeTurnId !== null ? ("running" as const) : ("ready" as const);
          }
        })();
        const lastError =
          event.type === "session.state.changed" && event.payload.state === "error"
            ? (event.payload.reason ?? thread.session?.lastError ?? "Provider session error")
            : event.type === "turn.completed" && runtimeTurnState(event) === "failed"
              ? (runtimeTurnErrorMessage(event) ?? thread.session?.lastError ?? "Turn failed")
              : status === "ready" || status === "interrupted"
                ? null
                : (thread.session?.lastError ?? null);

        if (shouldApplyThreadLifecycle) {
          if (event.type === "turn.started" && acceptedSourcePlan !== null) {
            yield* input.plans
              .markSourceProposedPlanImplemented(
                acceptedSourcePlan.sourceThreadId,
                acceptedSourcePlan.sourcePlanId,
                thread.id,
                event.createdAt,
              )
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning(
                    "provider runtime ingestion failed to mark source proposed plan",
                    {
                      eventId: event.eventId,
                      eventType: event.type,
                      cause: Cause.pretty(cause),
                    },
                  ),
                ),
              );
          }
          yield* input.orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: providerCommandId(event, "thread-session-set"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status,
              providerName: event.provider,
              runtimeMode: thread.session?.runtimeMode ?? "full-access",
              activeTurnId: nextActiveTurnId,
              lastError,
              updatedAt: event.createdAt,
            },
            createdAt: event.createdAt,
          });
        }
      }
      return { activeTurnId, eventTurnId, isTerminalTurnEvent, shouldApplyThreadLifecycle };
    });

  return { applyLifecycle };
}
