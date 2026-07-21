import type { OrchestrationEvent, OrchestrationReadModel } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ProjectorEffect } from "./common.ts";
import { projectMessageActivityEvent } from "./messageActivityEvents.ts";
import { projectProjectEvent } from "./projectEvents.ts";
import { projectRollbackEvent } from "./rollbackEvents.ts";
import { projectThreadLifecycleEvent } from "./threadLifecycleEvents.ts";
import { projectTurnSessionEvent } from "./turnSessionEvents.ts";

export function dispatchProjectorEvent(
  nextBase: OrchestrationReadModel,
  event: OrchestrationEvent,
): ProjectorEffect {
  switch (event.type) {
    case "project.created":
    case "project.meta-updated":
    case "project.deleted":
      return projectProjectEvent(nextBase, event);

    case "thread.created":
    case "thread.deleted":
    case "thread.archived":
    case "thread.unarchived":
    case "thread.meta-updated":
    case "thread.pinned-message-added":
    case "thread.pinned-message-removed":
    case "thread.pinned-message-done-set":
    case "thread.pinned-message-label-set":
    case "thread.marker-added":
    case "thread.marker-removed":
    case "thread.marker-done-set":
    case "thread.marker-label-set":
    case "thread.marker-color-set":
    case "thread.marker-note-set":
    case "thread.runtime-mode-set":
    case "thread.interaction-mode-set":
      return projectThreadLifecycleEvent(nextBase, event);

    case "thread.turn-start-requested":
    case "thread.message-sent":
      return projectMessageActivityEvent(nextBase, event);

    case "thread.session-set":
    case "thread.proposed-plan-upserted":
    case "thread.turn-diff-completed":
      return projectTurnSessionEvent(nextBase, event);

    case "thread.reverted":
    case "thread.conversation-rolled-back":
      return projectRollbackEvent(nextBase, event);

    case "thread.activity-appended":
      return projectMessageActivityEvent(nextBase, event);

    default:
      return Effect.succeed(nextBase);
  }
}
