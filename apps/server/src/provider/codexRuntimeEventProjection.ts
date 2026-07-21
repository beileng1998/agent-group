import type { ProviderEvent, ProviderRuntimeEvent, ThreadId } from "@agent-group/contracts";

import { mapCodexCoreEvent } from "./codexCoreEventProjection.ts";
import { mapCodexRuntimeNoticeEvent } from "./codexRuntimeNoticeProjection.ts";
import { mapCodexTurnEvent } from "./codexTurnEventProjection.ts";

export function mapCodexRuntimeEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ReadonlyArray<ProviderRuntimeEvent> {
  return (
    mapCodexCoreEvent(event, canonicalThreadId) ??
    mapCodexTurnEvent(event, canonicalThreadId) ??
    mapCodexRuntimeNoticeEvent(event, canonicalThreadId) ??
    []
  );
}
