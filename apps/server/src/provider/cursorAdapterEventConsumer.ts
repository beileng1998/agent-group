import type { EventId, ProviderRuntimeEvent, ThreadId } from "@agent-group/contracts";
import { Effect, Fiber, Stream } from "effect";

import { readAcpFailedToolDetail } from "./acp/AcpAdapterSupport.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpTokenUsageEvent,
  makeAcpToolCallEvent,
} from "./acp/AcpCoreRuntimeEvents.ts";
import {
  completeCursorAssistantItemTurnId,
  recordCursorSessionCost,
  resolveCursorAssistantItemTurnId,
  type CursorSessionContext,
} from "./cursorAdapterSessionState.ts";

const PROVIDER = "cursor" as const;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };
type CursorNativeSource = "acp.jsonrpc" | "acp.cursor.extension";

export function forkCursorEventConsumer(input: {
  readonly ctx: CursorSessionContext;
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly logNative: (
    threadId: ThreadId,
    method: string,
    payload: unknown,
    source: CursorNativeSource,
  ) => Effect.Effect<void>;
  readonly emitPlanUpdate: (
    ctx: CursorSessionContext,
    payload: {
      readonly explanation?: string | null;
      readonly plan: ReadonlyArray<{
        readonly step: string;
        readonly status: "pending" | "inProgress" | "completed";
      }>;
    },
    rawPayload: unknown,
    source: CursorNativeSource,
    method: string,
  ) => Effect.Effect<void>;
}): Effect.Effect<Fiber.Fiber<void, never>> {
  const ctx = input.ctx;
  return Stream.runDrain(
    Stream.mapEffect(ctx.acp.getEvents(), (event) =>
      Effect.gen(function* () {
        ctx.lastTurnActivityAt = Date.now();
        switch (event._tag) {
          case "ModeChanged":
            return;
          case "AssistantItemStarted": {
            const turnId = resolveCursorAssistantItemTurnId(ctx, event.itemId);
            yield* input.offerRuntimeEvent(
              makeAcpAssistantItemEvent({
                stamp: yield* input.makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId,
                itemId: event.itemId,
                lifecycle: "item.started",
              }),
            );
            return;
          }
          case "AssistantItemCompleted": {
            const turnId = completeCursorAssistantItemTurnId(ctx, event.itemId);
            yield* input.offerRuntimeEvent(
              makeAcpAssistantItemEvent({
                stamp: yield* input.makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId,
                itemId: event.itemId,
                lifecycle: "item.completed",
              }),
            );
            return;
          }
          case "PlanUpdated":
            yield* input.logNative(ctx.threadId, "session/update", event.rawPayload, "acp.jsonrpc");
            yield* input.emitPlanUpdate(
              ctx,
              event.payload,
              event.rawPayload,
              "acp.jsonrpc",
              "session/update",
            );
            return;
          case "ToolCallUpdated": {
            yield* input.logNative(ctx.threadId, "session/update", event.rawPayload, "acp.jsonrpc");
            const failedToolDetail = readAcpFailedToolDetail(event.toolCall);
            if (failedToolDetail !== undefined && ctx.activeTurnId !== undefined) {
              ctx.activeTurnFailedToolDetail = failedToolDetail;
            }
            yield* input.offerRuntimeEvent(
              makeAcpToolCallEvent({
                stamp: yield* input.makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                toolCall: event.toolCall,
                rawPayload: event.rawPayload,
              }),
            );
            return;
          }
          case "ContentDelta":
            yield* input.logNative(ctx.threadId, "session/update", event.rawPayload, "acp.jsonrpc");
            yield* input.offerRuntimeEvent(
              makeAcpContentDeltaEvent({
                stamp: yield* input.makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: resolveCursorAssistantItemTurnId(ctx, event.itemId),
                ...(event.itemId ? { itemId: event.itemId } : {}),
                text: event.text,
                ...(event.streamKind ? { streamKind: event.streamKind } : {}),
                rawPayload: event.rawPayload,
              }),
            );
            return;
          case "UsageUpdated":
            yield* input.logNative(ctx.threadId, "session/update", event.rawPayload, "acp.jsonrpc");
            recordCursorSessionCost(ctx, event.cost);
            yield* input.offerRuntimeEvent(
              makeAcpTokenUsageEvent({
                stamp: yield* input.makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                usage: event.usage,
                rawPayload: event.rawPayload,
              }),
            );
            return;
        }
      }),
    ),
  ).pipe(Effect.forkChild);
}
