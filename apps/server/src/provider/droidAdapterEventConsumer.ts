import {
  type EventId,
  type ProviderRuntimeEvent,
  RuntimeTaskId,
  type ThreadId,
  type TurnId,
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
import type { AcpParsedSessionEvent, AcpToolCallState } from "./acp/AcpRuntimeModel.ts";
import { isDroidAcpDebugEnabled } from "./droidAdapterLogging.ts";
import {
  type DroidSessionContext,
  isDroidNestedTaskToolCall,
  isRenderableDroidAssistantDelta,
  recordDroidSessionCost,
  scopeDroidRuntimeItemIdForTurn,
  scopeDroidToolCallStateForTurn,
} from "./droidAdapterSessionState.ts";

const PROVIDER = "droid" as const;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };

export function makeDroidEventConsumer(input: {
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly logNative: (threadId: ThreadId, method: string, payload: unknown) => Effect.Effect<void>;
}) {
  const emitPlanUpdate = (
    ctx: DroidSessionContext,
    event: Extract<AcpParsedSessionEvent, { readonly _tag: "PlanUpdated" }>,
  ) =>
    Effect.gen(function* () {
      const fingerprint = `${ctx.activeTurnId ?? "no-turn"}:${JSON.stringify(event.payload)}`;
      if (ctx.lastPlanFingerprint === fingerprint) return;
      ctx.lastPlanFingerprint = fingerprint;
      yield* input.offerRuntimeEvent(
        makeAcpPlanUpdatedEvent({
          stamp: yield* input.makeEventStamp(),
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

  const emitNestedTaskLifecycle = (
    ctx: DroidSessionContext,
    toolCall: AcpToolCallState,
    turnId: TurnId,
  ) =>
    Effect.gen(function* () {
      if (!isDroidNestedTaskToolCall(toolCall)) return;
      const previous = ctx.nestedTaskLifecycleByToolCallId.get(toolCall.toolCallId);
      const terminal = toolCall.status === "completed" || toolCall.status === "failed";
      if (terminal) {
        ctx.activeNestedTaskToolCallIds.delete(toolCall.toolCallId);
        if (previous === "completed") return;
        ctx.nestedTaskLifecycleByToolCallId.set(toolCall.toolCallId, "completed");
        yield* input.offerRuntimeEvent({
          type: "task.completed",
          ...(yield* input.makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId,
          payload: {
            taskId: RuntimeTaskId.makeUnsafe(toolCall.toolCallId),
            status: toolCall.status === "failed" ? "failed" : "completed",
            ...(toolCall.detail ? { summary: toolCall.detail } : {}),
          },
        });
        return;
      }
      ctx.activeNestedTaskToolCallIds.add(toolCall.toolCallId);
      if (previous !== undefined) return;
      ctx.nestedTaskLifecycleByToolCallId.set(toolCall.toolCallId, "active");
      const rawInput = toolCall.data.rawInput;
      const description =
        typeof rawInput === "object" &&
        rawInput !== null &&
        "description" in rawInput &&
        typeof rawInput.description === "string"
          ? rawInput.description
          : toolCall.detail;
      yield* input.offerRuntimeEvent({
        type: "task.started",
        ...(yield* input.makeEventStamp()),
        provider: PROVIDER,
        threadId: ctx.threadId,
        turnId,
        payload: {
          taskId: RuntimeTaskId.makeUnsafe(toolCall.toolCallId),
          taskType: "subagent",
          ...(description ? { description } : {}),
        },
      });
    });

  const noteSuppressedRuntimeEvent = (
    ctx: DroidSessionContext,
    eventTag: string,
    reason: "resume-replay" | "orphan-turn-event",
  ) =>
    Effect.gen(function* () {
      if (reason === "resume-replay") ctx.resumeReplayLastSuppressedAt = Date.now();
      if (!isDroidAcpDebugEnabled()) return;
      yield* Effect.logInfo("droid.acp.runtime_event_suppressed", {
        threadId: ctx.threadId,
        turnId: ctx.activeTurnId,
        eventTag,
        reason,
      });
    });

  const activeTurnIdForRuntimeEvent = (ctx: DroidSessionContext, eventTag: string) =>
    Effect.gen(function* () {
      if (ctx.resumeReplayReady !== undefined) {
        yield* noteSuppressedRuntimeEvent(ctx, eventTag, "resume-replay");
        return undefined;
      }
      if (ctx.activeTurnId === undefined) {
        yield* noteSuppressedRuntimeEvent(ctx, eventTag, "orphan-turn-event");
        return undefined;
      }
      return ctx.activeTurnId;
    });

  return (ctx: DroidSessionContext, event: AcpParsedSessionEvent) =>
    Effect.gen(function* () {
      ctx.lastTurnActivityAt = Date.now();
      switch (event._tag) {
        case "ModeChanged":
          return;
        case "AssistantItemStarted":
          yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          return;
        case "AssistantItemCompleted": {
          const turnId = yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          if (turnId === undefined) return;
          const itemId = scopeDroidRuntimeItemIdForTurn(turnId, event.itemId);
          if (!ctx.activeAssistantItemsWithContent.has(itemId)) {
            if (isDroidAcpDebugEnabled()) {
              yield* Effect.logInfo("droid.acp.empty_assistant_item_suppressed", {
                threadId: ctx.threadId,
                turnId,
                itemId,
              });
            }
            return;
          }
          ctx.activeAssistantItemsWithContent.delete(itemId);
          yield* input.offerRuntimeEvent(
            makeAcpAssistantItemEvent({
              stamp: yield* input.makeEventStamp(),
              provider: PROVIDER,
              threadId: ctx.threadId,
              turnId,
              itemId,
              lifecycle: "item.completed",
            }),
          );
          return;
        }
        case "PlanUpdated": {
          const turnId = yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          if (turnId === undefined) return;
          yield* input.logNative(ctx.threadId, "session/update", event.rawPayload);
          yield* emitPlanUpdate(ctx, event);
          return;
        }
        case "ToolCallUpdated": {
          const lateTurnId =
            ctx.resumeReplayReady === undefined && ctx.activeTurnId === undefined
              ? ctx.turnToolCallIds.get(event.toolCall.toolCallId)
              : undefined;
          if (lateTurnId !== undefined) {
            yield* input.logNative(ctx.threadId, "session/update", event.rawPayload);
            yield* emitNestedTaskLifecycle(ctx, event.toolCall, lateTurnId);
            yield* input.offerRuntimeEvent(
              makeAcpToolCallEvent({
                stamp: yield* input.makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: lateTurnId,
                toolCall: scopeDroidToolCallStateForTurn(lateTurnId, event.toolCall),
                rawPayload: event.rawPayload,
              }),
            );
            return;
          }
          const turnId = yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          if (turnId === undefined) return;
          ctx.turnToolCallIds.set(event.toolCall.toolCallId, turnId);
          yield* input.logNative(ctx.threadId, "session/update", event.rawPayload);
          yield* emitNestedTaskLifecycle(ctx, event.toolCall, turnId);
          const failedToolDetail = readAcpFailedToolDetail(event.toolCall);
          if (failedToolDetail !== undefined) ctx.activeTurnFailedToolDetail = failedToolDetail;
          yield* input.offerRuntimeEvent(
            makeAcpToolCallEvent({
              stamp: yield* input.makeEventStamp(),
              provider: PROVIDER,
              threadId: ctx.threadId,
              turnId,
              toolCall: scopeDroidToolCallStateForTurn(turnId, event.toolCall),
              rawPayload: event.rawPayload,
            }),
          );
          return;
        }
        case "ContentDelta": {
          const turnId = yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          if (turnId === undefined) return;
          yield* input.logNative(ctx.threadId, "session/update", event.rawPayload);
          const itemId = event.itemId
            ? scopeDroidRuntimeItemIdForTurn(turnId, event.itemId)
            : undefined;
          if (isRenderableDroidAssistantDelta(event)) {
            ctx.activeTurnHadAssistantContent = true;
            if (itemId !== undefined) ctx.activeAssistantItemsWithContent.add(itemId);
          }
          yield* input.offerRuntimeEvent(
            makeAcpContentDeltaEvent({
              stamp: yield* input.makeEventStamp(),
              provider: PROVIDER,
              threadId: ctx.threadId,
              turnId,
              ...(itemId ? { itemId } : {}),
              text: event.text,
              ...(event.streamKind ? { streamKind: event.streamKind } : {}),
              rawPayload: event.rawPayload,
            }),
          );
          return;
        }
        case "UsageUpdated": {
          const turnId = yield* activeTurnIdForRuntimeEvent(ctx, event._tag);
          if (turnId === undefined) return;
          yield* input.logNative(ctx.threadId, "session/update", event.rawPayload);
          recordDroidSessionCost(ctx, event.cost);
          yield* input.offerRuntimeEvent(
            makeAcpTokenUsageEvent({
              stamp: yield* input.makeEventStamp(),
              provider: PROVIDER,
              threadId: ctx.threadId,
              turnId,
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
