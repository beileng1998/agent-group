import type { OrchestrationEvent, OrchestrationReadModel } from "@agent-group/contracts";
import type { Effect } from "effect";

import type { OrchestrationProjectorDecodeError } from "./Errors.ts";
import { dispatchProjectorEvent } from "./projector/dispatcher.ts";

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  return dispatchProjectorEvent(nextBase, event);
}
