import type { ProviderEvent, ProviderRuntimeEvent, ThreadId } from "@agent-group/contracts";

import { mapCodexCoreEvent } from "./codexCoreEventProjection.ts";
import { eventRawSource, runtimeEventBase } from "./codexEventBase.ts";
import { asObject, asString, codexEventMessage } from "./codexEventValues.ts";
import { mapCodexRuntimeNoticeEvent } from "./codexRuntimeNoticeProjection.ts";
import { mapCodexTurnEvent } from "./codexTurnEventProjection.ts";
import {
  makeUnmappedProviderEventGate,
  sanitizeUnmappedProviderData,
  sanitizeUnmappedProviderDetail,
  sanitizeUnmappedProviderEvent,
  sanitizeUnmappedProviderNativeType,
} from "./unmappedProviderEvents.ts";

function firstReadable(values: ReadonlyArray<unknown>): string | undefined {
  for (const value of values) {
    const candidate = asString(value)?.trim();
    if (candidate) return candidate;
  }
  return undefined;
}

function mapUnmappedCodexEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ProviderRuntimeEvent {
  const payload = asObject(event.payload);
  const message = codexEventMessage(payload);
  const nativeType = sanitizeUnmappedProviderNativeType(event.method);
  const detail = sanitizeUnmappedProviderDetail(
    firstReadable([
      payload?.message,
      message?.summary,
      payload?.reason,
      payload?.summary,
      message?.status,
      payload?.detail,
      payload?.status,
    ]),
  );
  return {
    ...runtimeEventBase(event, canonicalThreadId),
    raw: {
      source: eventRawSource(event),
      method: nativeType,
      payload: { agentGroupSanitized: true },
    },
    type: "event.unmapped",
    payload: {
      nativeType,
      ...(detail ? { detail } : {}),
      ...(event.payload !== undefined ? { data: sanitizeUnmappedProviderData(event.payload) } : {}),
    },
  };
}

export function mapCodexRuntimeEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ReadonlyArray<ProviderRuntimeEvent> {
  const mapped =
    mapCodexCoreEvent(event, canonicalThreadId) ??
    mapCodexTurnEvent(event, canonicalThreadId) ??
    mapCodexRuntimeNoticeEvent(event, canonicalThreadId);
  return mapped ?? [mapUnmappedCodexEvent(event, canonicalThreadId)];
}

export function makeCodexRuntimeEventProjector() {
  const shouldSurfaceUnmappedEvent = makeUnmappedProviderEventGate();
  return (event: ProviderEvent, canonicalThreadId: ThreadId) => {
    const mapped = mapCodexRuntimeEvents(event, canonicalThreadId);
    const hasUnmapped = mapped.some((runtimeEvent) => runtimeEvent.type === "event.unmapped");
    return {
      nativeEvent: hasUnmapped ? sanitizeUnmappedProviderEvent(event) : event,
      runtimeEvents: mapped.filter(
        (runtimeEvent) =>
          runtimeEvent.type !== "event.unmapped" || shouldSurfaceUnmappedEvent(event),
      ),
    };
  };
}
