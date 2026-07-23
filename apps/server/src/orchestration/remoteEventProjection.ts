import {
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationShellStreamEvent,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";

import type { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery";
import { shouldPublishThreadShellForEvent } from "./threadShellEvents";

export function isShellRelevantEvent(event: OrchestrationEvent): boolean {
  switch (event.type) {
    case "project.created":
    case "project.meta-updated":
    case "project.deleted":
    case "thread.deleted":
      return true;
    default:
      return event.aggregateKind === "thread" && shouldPublishThreadShellForEvent(event);
  }
}

export function isThreadDetailEvent(event: OrchestrationEvent): boolean {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.conversation-rolled-back" ||
    event.type === "thread.session-set" ||
    event.type === "thread.meta-updated" ||
    event.type === "thread.pinned-message-added" ||
    event.type === "thread.pinned-message-removed" ||
    event.type === "thread.pinned-message-done-set" ||
    event.type === "thread.pinned-message-label-set" ||
    event.type === "thread.marker-added" ||
    event.type === "thread.marker-removed" ||
    event.type === "thread.marker-done-set" ||
    event.type === "thread.marker-label-set" ||
    event.type === "thread.marker-color-set" ||
    event.type === "thread.marker-note-set" ||
    event.type === "thread.archived" ||
    event.type === "thread.unarchived"
  );
}

export const isThreadDetailEventFor = (threadId: ThreadId, event: OrchestrationEvent) =>
  event.aggregateKind === "thread" && event.aggregateId === threadId && isThreadDetailEvent(event);

export function makeShellStreamProjector(
  projectionReadModelQuery: typeof ProjectionSnapshotQuery.Service,
) {
  return (
    event: OrchestrationEvent,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never> => {
    switch (event.type) {
      case "project.created":
      case "project.meta-updated":
        return projectionReadModelQuery.getProjectShellById(event.payload.projectId).pipe(
          Effect.map((project) =>
            Option.map(project, (nextProject) => ({
              kind: "project-upserted" as const,
              sequence: event.sequence,
              project: nextProject,
            })),
          ),
          Effect.catch(() => Effect.succeed(Option.none())),
        );
      case "project.deleted":
        return Effect.succeed(
          Option.some({
            kind: "project-removed" as const,
            sequence: event.sequence,
            projectId: event.payload.projectId,
          }),
        );
      case "thread.deleted":
        return Effect.succeed(
          Option.some({
            kind: "thread-removed" as const,
            sequence: event.sequence,
            threadId: event.payload.threadId,
          }),
        );
      default:
        if (event.aggregateKind !== "thread") return Effect.succeed(Option.none());
        return projectionReadModelQuery
          .getThreadShellById(ThreadId.makeUnsafe(String(event.aggregateId)))
          .pipe(
            Effect.map((thread) =>
              Option.map(thread, (nextThread) => ({
                kind: "thread-upserted" as const,
                sequence: event.sequence,
                thread: nextThread,
              })),
            ),
            Effect.catch(() => Effect.succeed(Option.none())),
          );
    }
  };
}
