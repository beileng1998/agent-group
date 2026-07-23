// FILE: remoteOrchestrationRoutes.test.ts
// Purpose: Verifies cursor advancement and thread filtering for HTTP event fallback.
// Layer: Server HTTP transport tests

import {
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import type { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { makeRemoteEventBatch } from "./remoteOrchestrationRoutes";

const occurredAt = "2026-07-23T00:00:00.000Z";

function deletedProjectEvent(sequence: number): OrchestrationEvent {
  const projectId = ProjectId.makeUnsafe("project-deleted");
  return {
    type: "project.deleted",
    sequence,
    eventId: EventId.makeUnsafe(`event-${sequence}`),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: { projectId },
  };
}

function messageEvent(sequence: number, threadId: ThreadId): OrchestrationEvent {
  return {
    type: "thread.message-sent",
    sequence,
    eventId: EventId.makeUnsafe(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId,
      messageId: MessageId.makeUnsafe(`message-${sequence}`),
      role: "user",
      text: "hello",
      turnId: null,
      streaming: false,
      source: "native",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
  };
}

describe("remote event batches", () => {
  it("advances the global cursor while returning only the selected thread detail", async () => {
    const currentThreadId = ThreadId.makeUnsafe("thread-current");
    const otherThreadId = ThreadId.makeUnsafe("thread-other");
    const projectionSnapshotQuery = {
      getProjectShellById: () => Effect.succeed(Option.none()),
      getThreadShellById: () => Effect.succeed(Option.none()),
    } as unknown as typeof ProjectionSnapshotQuery.Service;

    const batch = await Effect.runPromise(
      makeRemoteEventBatch({
        afterSequence: 10,
        events: [
          deletedProjectEvent(11),
          messageEvent(12, currentThreadId),
          messageEvent(13, otherThreadId),
        ],
        threadId: currentThreadId,
        projectionSnapshotQuery,
      }),
    );

    expect(batch.nextSequence).toBe(13);
    expect(batch.shellEvents).toEqual([
      {
        kind: "project-removed",
        sequence: 11,
        projectId: "project-deleted",
      },
    ]);
    expect(batch.threadEvents.map((event) => event.sequence)).toEqual([12]);
  });
});
