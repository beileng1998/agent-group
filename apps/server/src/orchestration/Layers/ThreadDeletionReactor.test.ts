import {
  CommandId,
  CorrelationId,
  EventId,
  ThreadId,
  type OrchestrationEvent,
} from "@agent-group/contracts";
import {
  Cause,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Queue,
  Scope,
  Stream,
} from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  ProfileStatsArchive,
  type ProfileStatsArchiveShape,
} from "../../profileStatsArchive";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService";
import {
  TerminalManager,
  type TerminalManagerShape,
} from "../../terminal/Services/Manager";
import {
  TerminalAgentService,
  type TerminalAgentServiceShape,
} from "../../terminalAgent/Services/TerminalAgentService";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor";
import {
  ExecutionAdapterCoordinator,
  type ExecutionAdapterCoordinatorShape,
} from "../Services/ExecutionAdapterCoordinator";
import {
  cleanupSucceededUnlessInterrupted,
  logCleanupCauseUnlessInterrupted,
  ThreadDeletionReactorLive,
} from "./ThreadDeletionReactor";

type ThreadDeletedEvent = Extract<OrchestrationEvent, { type: "thread.deleted" }>;

const makeThreadDeletedEvent = (threadId: ThreadId): ThreadDeletedEvent => ({
  type: "thread.deleted",
  eventId: EventId.makeUnsafe(`event:${threadId}`),
  aggregateKind: "thread",
  aggregateId: threadId,
  occurredAt: "2026-07-25T00:00:00.000Z",
  commandId: CommandId.makeUnsafe(`command:${threadId}`),
  causationEventId: null,
  correlationId: CorrelationId.makeUnsafe(`command:${threadId}`),
  metadata: {},
  payload: {
    threadId,
    deletedAt: "2026-07-25T00:00:00.000Z",
  },
});

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for thread deletion reactor.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("logCleanupCauseUnlessInterrupted", () => {
  const threadId = ThreadId.makeUnsafe("thread-deletion-reactor-test");

  it("swallows ordinary cleanup failures", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});

describe("ThreadDeletionReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<ThreadDeletionReactor, unknown> | null = null;
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  const startHarness = async ({
    teardownFails = false,
  }: {
    readonly teardownFails?: boolean;
  } = {}) => {
    const events = Effect.runSync(Queue.unbounded<OrchestrationEvent>());
    const operations: string[] = [];

    const orchestrationEngine = {
      streamDomainEvents: Stream.fromQueue(events),
      refreshCommandReadModel: () => Effect.succeed({}),
    } as unknown as OrchestrationEngineShape;
    const profileStatsArchive = {
      purgeThreadWithStatsSnapshot: ({ threadId }) =>
        Effect.sync(() => {
          operations.push(`purge:${threadId}`);
          return true;
        }),
      purgeSoftDeletedManualThreads: () => Effect.succeed(0),
    } satisfies ProfileStatsArchiveShape;
    const providerService = {
      stopSession: ({ threadId }) =>
        Effect.sync(() => {
          operations.push(`provider:${threadId}`);
        }),
    } as unknown as ProviderServiceShape;
    const terminalManager = {
      close: ({ threadId }) =>
        Effect.sync(() => {
          operations.push(`terminal:${threadId}`);
        }),
    } as unknown as TerminalManagerShape;
    const terminalAgentService = {
      teardownThread: (threadId: ThreadId) =>
        Effect.sync(() => {
          operations.push(`managed:${threadId}`);
          if (teardownFails) {
            throw new Error("managed terminal teardown failed");
          }
        }),
    } as unknown as TerminalAgentServiceShape;
    const executionAdapterCoordinator = {
      finalizeThreadDeletion: (threadId: ThreadId) =>
        Effect.sync(() => {
          operations.push(`authority:${threadId}`);
        }),
    } as unknown as ExecutionAdapterCoordinatorShape;

    const layer = ThreadDeletionReactorLive.pipe(
      Layer.provideMerge(Layer.succeed(OrchestrationEngineService, orchestrationEngine)),
      Layer.provideMerge(Layer.succeed(ProfileStatsArchive, profileStatsArchive)),
      Layer.provideMerge(Layer.succeed(ProviderService, providerService)),
      Layer.provideMerge(Layer.succeed(TerminalManager, terminalManager)),
      Layer.provideMerge(Layer.succeed(TerminalAgentService, terminalAgentService)),
      Layer.provideMerge(
        Layer.succeed(ExecutionAdapterCoordinator, executionAdapterCoordinator),
      ),
    );
    runtime = ManagedRuntime.make(layer);
    const reactor = await runtime.runPromise(Effect.service(ThreadDeletionReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));

    return {
      operations,
      reactor,
      emit: (event: OrchestrationEvent) =>
        Effect.runPromise(Queue.offer(events, event).pipe(Effect.asVoid)),
    };
  };

  it("tears down the managed terminal before purging a deleted thread", async () => {
    const threadId = ThreadId.makeUnsafe("thread-delete-success");
    const harness = await startHarness();

    await harness.emit(makeThreadDeletedEvent(threadId));
    await waitFor(() => harness.operations.includes(`purge:${threadId}`));
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.operations).toEqual([
      `managed:${threadId}`,
      `provider:${threadId}`,
      `terminal:${threadId}`,
      `authority:${threadId}`,
      `purge:${threadId}`,
    ]);
  });

  it("defers purge when managed terminal teardown fails", async () => {
    const threadId = ThreadId.makeUnsafe("thread-delete-teardown-failure");
    const harness = await startHarness({ teardownFails: true });

    await harness.emit(makeThreadDeletedEvent(threadId));
    await waitFor(() => harness.operations.includes(`managed:${threadId}`));
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.operations).toEqual([`managed:${threadId}`]);
  });
});

describe("cleanupSucceededUnlessInterrupted", () => {
  const threadId = ThreadId.makeUnsafe("thread-deletion-reactor-test");

  it("returns true for successful cleanup", async () => {
    const result = await Effect.runPromise(
      cleanupSucceededUnlessInterrupted({
        effect: Effect.void,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(result).toBe(true);
  });

  it("returns false for ordinary cleanup failures", async () => {
    const result = await Effect.runPromise(
      cleanupSucceededUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(result).toBe(false);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      cleanupSucceededUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});
