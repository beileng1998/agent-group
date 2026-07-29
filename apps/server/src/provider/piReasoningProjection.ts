// FILE: piReasoningProjection.ts
// Purpose: Project Pi SDK thinking blocks into one bounded, live runtime item.
// Layer: Pi provider adapter

import crypto from "node:crypto";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  EventId,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";

import { PROVIDER, type PiSessionContext } from "./piAdapterCore.ts";

const PI_REASONING_UPDATE_INTERVAL_MS = 160;
const PI_REASONING_DETAIL_MAX_CHARS = 8_000;

type PiMessageUpdateEvent = Extract<AgentSessionEvent, { type: "message_update" }>;

function boundedPiReasoningText(value: string): string {
  return value.length <= PI_REASONING_DETAIL_MAX_CHARS
    ? value
    : `…${value.slice(-(PI_REASONING_DETAIL_MAX_CHARS - 1))}`;
}

export function makePiReasoningProjection(dependencies: {
  readonly makeEventBase: (
    context: PiSessionContext,
  ) => {
    readonly eventId: EventId;
    readonly provider: typeof PROVIDER;
    readonly threadId: ThreadId;
    readonly createdAt: string;
    readonly turnId?: TurnId;
  };
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => void;
}) {
  const clear = (context: PiSessionContext) => {
    context.activeReasoningItemId = undefined;
    context.activeReasoningText = "";
    context.activeReasoningLastPublishedAt = undefined;
  };

  const start = (context: PiSessionContext, event: PiMessageUpdateEvent) => {
    if (context.activeReasoningItemId) return;
    const itemId = RuntimeItemId.makeUnsafe(`pi-reasoning-${crypto.randomUUID()}`);
    context.activeReasoningItemId = itemId;
    context.activeReasoningText = "";
    context.activeReasoningLastPublishedAt = undefined;
    dependencies.offerRuntimeEvent({
      ...dependencies.makeEventBase(context),
      itemId,
      type: "item.started",
      payload: { itemType: "reasoning", status: "inProgress", title: "Thinking" },
      raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
    } satisfies ProviderRuntimeEvent);
  };

  const appendDelta = (
    context: PiSessionContext,
    event: PiMessageUpdateEvent,
    delta: string,
  ) => {
    start(context, event);
    context.activeReasoningText = boundedPiReasoningText(context.activeReasoningText + delta);
    const itemId = context.activeReasoningItemId;
    const detail = context.activeReasoningText.trim();
    if (!itemId || !detail) return;
    const now = Date.now();
    const elapsed = now - (context.activeReasoningLastPublishedAt ?? 0);
    const reachedReadableBoundary = /(?:[.!?。！？]|[\r\n])\s*$/u.test(delta);
    if (
      context.activeReasoningLastPublishedAt !== undefined &&
      elapsed < PI_REASONING_UPDATE_INTERVAL_MS &&
      !reachedReadableBoundary
    ) {
      return;
    }
    context.activeReasoningLastPublishedAt = now;
    dependencies.offerRuntimeEvent({
      ...dependencies.makeEventBase(context),
      itemId,
      type: "item.updated",
      payload: {
        itemType: "reasoning",
        status: "inProgress",
        title: "Thinking",
        detail,
      },
      raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
    } satisfies ProviderRuntimeEvent);
  };

  const complete = (
    context: PiSessionContext,
    event: AgentSessionEvent,
    status: "completed" | "failed",
    finalText?: string,
  ) => {
    const itemId = context.activeReasoningItemId;
    if (!itemId) return;
    const detail = boundedPiReasoningText(finalText ?? context.activeReasoningText).trim();
    dependencies.offerRuntimeEvent({
      ...dependencies.makeEventBase(context),
      itemId,
      type: "item.completed",
      payload: {
        itemType: "reasoning",
        status,
        title: "Thinking",
        ...(detail ? { detail } : {}),
      },
      raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
    } satisfies ProviderRuntimeEvent);
    clear(context);
  };

  return { appendDelta, clear, complete, start };
}
