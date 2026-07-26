import { CommandId, EventId, ThreadId, type OrchestrationEvent } from "@agent-group/contracts";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeExecutionAdapterAuthority } from "../ExecutionAdapterAuthority";
import { makeCheckpointRestoreHandler } from "./checkpointRestoreHandler";

const now = "2026-07-26T00:00:00.000Z";
const threadId = ThreadId.makeUnsafe("thread-delayed-checkpoint-restore");

describe("checkpoint restore authority", () => {
  it("does not touch the workspace when a queued restore loses structured authority", async () => {
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        persist: () => Effect.void,
        now: () => new Date(now),
      }),
    );
    const getThreadDetail = vi.fn(() => Effect.die("restore must not execute"));
    const restore = makeCheckpointRestoreHandler({
      checkpointStore: {} as never,
      lookup: { getThreadDetail } as never,
      orchestrationEngine: {} as never,
      providerService: {} as never,
      status: {} as never,
      acquireStructured: authority.acquireStructured,
    });
    const event = {
      sequence: 1,
      eventId: EventId.makeUnsafe("event-delayed-checkpoint-restore"),
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: CommandId.makeUnsafe("command-delayed-checkpoint-restore"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe("command-delayed-checkpoint-restore"),
      metadata: {},
      type: "thread.checkpoint-revert-requested",
      payload: {
        threadId,
        turnCount: 1,
        scope: "thread",
        createdAt: now,
      },
    } satisfies Extract<OrchestrationEvent, { type: "thread.checkpoint-revert-requested" }>;
    const queuedRestore = restore(event);

    await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-delayed-checkpoint-restore",
        providerSessionId: null,
        startedAt: now,
      }),
    );
    const exit = await Effect.runPromiseExit(queuedRestore);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(getThreadDetail).not.toHaveBeenCalled();
  });
});
