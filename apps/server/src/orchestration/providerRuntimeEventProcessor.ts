import { type ProviderRuntimeEvent } from "@agent-group/contracts";
import { Effect, Ref } from "effect";

import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import { runtimeEventToActivities } from "./providerRuntimeActivityProjection.ts";
import type { makeProviderRuntimeAssistantMessages } from "./providerRuntimeAssistantMessages.ts";
import type { ProviderRuntimeBufferState } from "./providerRuntimeBufferState.ts";
import {
  withBufferedReasoningSummary,
  withBufferedToolOutputData,
} from "./providerRuntimeBufferValues.ts";
import type { makeProviderRuntimeBuffers } from "./providerRuntimeBuffers.ts";
import type { makeProviderRuntimeDiff } from "./providerRuntimeDiff.ts";
import type { makeProviderRuntimeEventProjection } from "./providerRuntimeEventProjection.ts";
import type { makeProviderRuntimeLifecycle } from "./providerRuntimeLifecycle.ts";
import type { makeProviderRuntimeQueries } from "./providerRuntimeQueries.ts";
import type { makeProviderRuntimeSubagentRouting } from "./providerRuntimeSubagentRouting.ts";
import type { makeProviderRuntimeUpdateDispatch } from "./providerRuntimeUpdateDispatch.ts";
import {
  DEFAULT_ASSISTANT_DELIVERY_MODE,
  type RuntimeIngestionDomainEvent,
} from "./providerRuntimeIngestionValues.ts";

type Queries = ReturnType<typeof makeProviderRuntimeQueries>;
type Routing = ReturnType<typeof makeProviderRuntimeSubagentRouting>;
type Lifecycle = ReturnType<typeof makeProviderRuntimeLifecycle>;
type Projection = ReturnType<typeof makeProviderRuntimeEventProjection>;
type Diff = ReturnType<typeof makeProviderRuntimeDiff>;
type Buffers = ReturnType<typeof makeProviderRuntimeBuffers>;
type Assistants = ReturnType<typeof makeProviderRuntimeAssistantMessages>;
type Updates = ReturnType<typeof makeProviderRuntimeUpdateDispatch>;

export function makeProviderRuntimeEventProcessor(input: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly state: ProviderRuntimeBufferState;
  readonly queries: Queries;
  readonly routing: Routing;
  readonly lifecycle: Lifecycle;
  readonly projection: Projection;
  readonly diff: Diff;
  readonly buffers: Buffers;
  readonly assistants: Assistants;
  readonly updates: Updates;
}) {
  const processRuntimeEvent = (event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      const parentThread = yield* input.queries.getThreadForEvent(event);
      if (!parentThread) return;
      const projectedProvider = parentThread.session?.providerName;
      if (
        parentThread.session?.status === "starting" &&
        typeof projectedProvider === "string" &&
        projectedProvider.trim().length > 0 &&
        event.provider !== projectedProvider
      ) {
        yield* Effect.logDebug("provider runtime ingestion ignored stale provider event", {
          threadId: event.threadId,
          eventProvider: event.provider,
          projectedProvider,
          eventType: event.type,
        });
        return;
      }

      const { thread } = yield* input.routing.resolveTargetThread(event, parentThread);
      const lifecycle = yield* input.lifecycle.applyLifecycle(event, thread);
      const { toolOutputKey, reasoningSummaryKey } = yield* input.projection.projectEvent({
        event,
        thread,
        activeTurnId: lifecycle.activeTurnId,
        eventTurnId: lifecycle.eventTurnId,
        isTerminalTurnEvent: lifecycle.isTerminalTurnEvent,
      });
      yield* input.diff.processTurnDiff(event, thread);

      const activityEvent =
        event.type === "item.completed" && reasoningSummaryKey
          ? withBufferedReasoningSummary(
              event,
              yield* input.buffers.takeBufferedReasoningSummary(reasoningSummaryKey),
            )
          : event.type === "item.completed" && toolOutputKey
            ? withBufferedToolOutputData(
                event,
                yield* input.buffers.takeBufferedToolOutput(toolOutputKey),
              )
            : event.type === "item.updated" && toolOutputKey
              ? withBufferedToolOutputData(
                  event,
                  yield* input.buffers.getBufferedToolOutput(toolOutputKey),
                )
              : event;
      yield* Effect.forEach(
        runtimeEventToActivities(activityEvent),
        (activity) => input.updates.dispatchActivityUpdate(activityEvent, thread.id, activity),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);

      if (event.type === "turn.completed" || event.type === "turn.aborted") {
        yield* input.buffers.settleBufferedReasoningSummaries(
          thread.id,
          event,
          lifecycle.eventTurnId,
        );
      } else if (event.type === "session.exited") {
        yield* input.buffers.settleBufferedReasoningSummaries(thread.id, event);
      } else if (event.type === "runtime.error") {
        yield* input.buffers.settleBufferedReasoningSummaries(
          thread.id,
          event,
          lifecycle.eventTurnId ?? lifecycle.activeTurnId ?? undefined,
        );
      }
    });

  const processDomainEvent = (event: RuntimeIngestionDomainEvent) =>
    Effect.gen(function* () {
      if (event.type === "thread.reverted" || event.type === "thread.conversation-rolled-back") {
        yield* input.updates.clearActivityUpdateFingerprints(event.payload.threadId);
        return;
      }
      const mode = event.payload.assistantDeliveryMode ?? DEFAULT_ASSISTANT_DELIVERY_MODE;
      yield* Ref.set(input.state.assistantDeliveryModeRef, mode);
      if (mode !== "streaming") return;
      const thread = yield* input.queries.getThreadShellDetail(event.payload.threadId);
      const activeTurnId = thread?.session?.activeTurnId ?? undefined;
      if (!activeTurnId) return;
      const flushEvent: ProviderRuntimeEvent = {
        type: "turn.started",
        eventId: event.eventId,
        provider: thread?.session?.providerName === "claudeAgent" ? "claudeAgent" : "codex",
        createdAt: event.payload.createdAt,
        threadId: event.payload.threadId,
        turnId: activeTurnId,
        payload: {},
      };
      yield* input.assistants.flushBufferedAssistantMessagesForTurn({
        event: flushEvent,
        threadId: event.payload.threadId,
        turnId: activeTurnId,
        createdAt: event.payload.createdAt,
        commandTag: "assistant-delta-domain-flush",
      });
    });

  return { processRuntimeEvent, processDomainEvent };
}
