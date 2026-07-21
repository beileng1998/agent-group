import {
  type EventId,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  type ThreadId,
} from "@agent-group/contracts";
import { Effect } from "effect";

import { readAcpFailedToolDetail } from "./acp/AcpAdapterSupport.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpTokenUsageEvent,
  makeAcpToolCallEvent,
} from "./acp/AcpCoreRuntimeEvents.ts";
import type { AcpParsedSessionEvent } from "./acp/AcpRuntimeModel.ts";
import { isGrokAcpDebugEnabled } from "./grokAdapterLogging.ts";
import {
  type GrokSessionContext,
  isGrokContextCompactionToolCall,
  isRenderableGrokAssistantDelta,
  recordGrokSessionCost,
  scopeGrokRuntimeItemIdForTurn,
  scopeGrokToolCallStateForTurn,
} from "./grokAdapterSessionState.ts";

const PROVIDER = "grok" as const;

interface GrokEventStamp {
  readonly eventId: EventId;
  readonly createdAt: string;
}

interface GrokEventConsumerDependencies {
  readonly makeEventStamp: () => Effect.Effect<GrokEventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly logNative: (threadId: ThreadId, method: string, payload: unknown) => Effect.Effect<void>;
}

export function makeGrokEventConsumer(deps: GrokEventConsumerDependencies) {
  const emitPlanUpdate = (
    ctx: GrokSessionContext,
    event: Extract<AcpParsedSessionEvent, { readonly _tag: "PlanUpdated" }>,
  ) =>
    Effect.gen(function* () {
      const fingerprint = `${ctx.activeTurnId ?? "no-turn"}:${JSON.stringify(event.payload)}`;
      if (ctx.lastPlanFingerprint === fingerprint) return;
      ctx.lastPlanFingerprint = fingerprint;
      yield* deps.offerRuntimeEvent(
        makeAcpPlanUpdatedEvent({
          stamp: yield* deps.makeEventStamp(),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: ctx.activeTurnId,
          payload: event.payload,
          source: "acp.jsonrpc",
          method: "session/update",
          rawPayload: event.rawPayload,
        }),
      );
    });

  const noteSuppressedRuntimeEvent = (
    ctx: GrokSessionContext,
    eventTag: string,
    reason: "resume-replay" | "orphan-turn-event",
  ) =>
    Effect.gen(function* () {
      if (reason === "resume-replay") ctx.resumeReplayLastSuppressedAt = Date.now();
      if (!isGrokAcpDebugEnabled()) return;
      yield* Effect.logInfo("grok.acp.runtime_event_suppressed", {
        threadId: ctx.threadId,
        turnId: ctx.activeTurnId,
        eventTag,
        reason,
      });
    });

  const activeTurnIdForRuntimeEvent = (ctx: GrokSessionContext, eventTag: string) =>
    Effect.gen(function* () {
      if (ctx.resumeReplayReady !== undefined) {
        yield* noteSuppressedRuntimeEvent(ctx, eventTag, "resume-replay");
        return undefined;
      }
      if (ctx.compactingThread) return undefined;
      if (ctx.activeTurnId === undefined) {
        yield* noteSuppressedRuntimeEvent(ctx, eventTag, "orphan-turn-event");
        return undefined;
      }
      return ctx.activeTurnId;
    });

  return (ctx: GrokSessionContext, event: AcpParsedSessionEvent) =>
    Effect.gen(function* () {
      ctx.lastTurnActivityAt = Date.now();
      switch (event._tag) {
        case "ModeChanged":
          return;
        case "AssistantItemStarted": {
          yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          return;
        }
        case "AssistantItemCompleted": {
          const activeTurnId = yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          if (activeTurnId === undefined) return;
          const scopedItemId = scopeGrokRuntimeItemIdForTurn(activeTurnId, event.itemId);
          if (!ctx.activeAssistantItemsWithContent.has(scopedItemId)) {
            if (isGrokAcpDebugEnabled()) {
              yield* Effect.logInfo("grok.acp.empty_assistant_item_suppressed", {
                threadId: ctx.threadId,
                turnId: activeTurnId,
                itemId: scopedItemId,
              });
            }
            return;
          }
          ctx.activeAssistantItemsWithContent.delete(scopedItemId);
          yield* deps.offerRuntimeEvent(
            makeAcpAssistantItemEvent({
              stamp: yield* deps.makeEventStamp(),
              provider: PROVIDER,
              threadId: ctx.threadId,
              turnId: activeTurnId,
              itemId: scopedItemId,
              lifecycle: "item.completed",
            }),
          );
          return;
        }
        case "PlanUpdated": {
          const activeTurnId = yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          if (activeTurnId === undefined) return;
          yield* deps.logNative(ctx.threadId, "session/update", event.rawPayload);
          yield* emitPlanUpdate(ctx, event);
          return;
        }
        case "ToolCallUpdated": {
          if (
            ctx.compactionQuietUntil !== undefined &&
            Date.now() < ctx.compactionQuietUntil &&
            isGrokContextCompactionToolCall(event.toolCall)
          ) {
            return;
          }
          const lateTurnId =
            ctx.resumeReplayReady === undefined &&
            ctx.activeTurnId === undefined &&
            !ctx.compactingThread
              ? ctx.turnToolCallIds.get(event.toolCall.toolCallId)
              : undefined;
          const treatAsCompaction =
            ctx.compactingThread ||
            (ctx.resumeReplayReady === undefined &&
              ctx.activeTurnId === undefined &&
              lateTurnId === undefined &&
              isGrokContextCompactionToolCall(event.toolCall));
          if (treatAsCompaction) {
            const isTerminal =
              event.toolCall.status === "completed" || event.toolCall.status === "failed";
            if (ctx.compactingThread && event.toolCall.status === "failed") {
              ctx.compactionFailedToolDetail =
                readAcpFailedToolDetail(event.toolCall) ??
                event.toolCall.detail ??
                event.toolCall.title ??
                "Grok reported a failed compaction tool call.";
            }
            const emitTerminal = isTerminal && !ctx.compactingThread;
            const status = emitTerminal
              ? event.toolCall.status === "failed"
                ? "failed"
                : "completed"
              : "inProgress";
            yield* Effect.gen(function* () {
              yield* deps.offerRuntimeEvent({
                type: emitTerminal ? "item.completed" : "item.updated",
                ...(yield* deps.makeEventStamp()),
                provider: PROVIDER,
                threadId: ctx.threadId,
                itemId: RuntimeItemId.makeUnsafe(`grok-compaction:${ctx.threadId}`),
                payload: {
                  itemType: "context_compaction",
                  status,
                  title:
                    event.toolCall.title?.trim() ||
                    (status === "completed" ? "Context compacted" : "Compacting context"),
                  ...(event.toolCall.detail ? { detail: event.toolCall.detail } : {}),
                },
              });
            });
            return;
          }
          if (lateTurnId !== undefined) {
            yield* deps.logNative(ctx.threadId, "session/update", event.rawPayload);
            yield* deps.offerRuntimeEvent(
              makeAcpToolCallEvent({
                stamp: yield* deps.makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: lateTurnId,
                toolCall: scopeGrokToolCallStateForTurn(lateTurnId, event.toolCall),
                rawPayload: event.rawPayload,
              }),
            );
            return;
          }
          const activeTurnId = yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          if (activeTurnId === undefined) return;
          ctx.turnToolCallIds.set(event.toolCall.toolCallId, activeTurnId);
          yield* deps.logNative(ctx.threadId, "session/update", event.rawPayload);
          const failedToolDetail = readAcpFailedToolDetail(event.toolCall);
          if (failedToolDetail !== undefined) ctx.activeTurnFailedToolDetail = failedToolDetail;
          yield* deps.offerRuntimeEvent(
            makeAcpToolCallEvent({
              stamp: yield* deps.makeEventStamp(),
              provider: PROVIDER,
              threadId: ctx.threadId,
              turnId: activeTurnId,
              toolCall: scopeGrokToolCallStateForTurn(activeTurnId, event.toolCall),
              rawPayload: event.rawPayload,
            }),
          );
          return;
        }
        case "ContentDelta": {
          const activeTurnId = yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          if (activeTurnId === undefined) return;
          yield* deps.logNative(ctx.threadId, "session/update", event.rawPayload);
          const scopedItemId = event.itemId
            ? scopeGrokRuntimeItemIdForTurn(activeTurnId, event.itemId)
            : undefined;
          if (isRenderableGrokAssistantDelta(event)) {
            ctx.activeTurnHadAssistantContent = true;
            if (scopedItemId !== undefined) ctx.activeAssistantItemsWithContent.add(scopedItemId);
          }
          yield* deps.offerRuntimeEvent(
            makeAcpContentDeltaEvent({
              stamp: yield* deps.makeEventStamp(),
              provider: PROVIDER,
              threadId: ctx.threadId,
              turnId: activeTurnId,
              ...(scopedItemId ? { itemId: scopedItemId } : {}),
              text: event.text,
              ...(event.streamKind ? { streamKind: event.streamKind } : {}),
              rawPayload: event.rawPayload,
            }),
          );
          return;
        }
        case "UsageUpdated": {
          const activeTurnId = yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          if (activeTurnId === undefined) return;
          yield* deps.logNative(ctx.threadId, "session/update", event.rawPayload);
          recordGrokSessionCost(ctx, event.cost);
          yield* deps.offerRuntimeEvent(
            makeAcpTokenUsageEvent({
              stamp: yield* deps.makeEventStamp(),
              provider: PROVIDER,
              threadId: ctx.threadId,
              turnId: activeTurnId,
              usage: event.usage,
              rawPayload: event.rawPayload,
            }),
          );
          return;
        }
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          ctx.sessionUpdatesProcessed += 1;
        }),
      ),
    );
}
