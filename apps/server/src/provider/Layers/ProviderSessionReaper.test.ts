import { ThreadId, TurnId, type OrchestrationThreadShell } from "@agent-group/contracts";
import { Cause, Deferred, Effect, Exit, Layer, Option, Scope, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeExecutionAdapterAuthority } from "../../orchestration/Layers/ExecutionAdapterAuthority";
import {
  ExecutionAdapterAuthority,
  type ExecutionAdapterAuthorityShape,
} from "../../orchestration/Services/ExecutionAdapterAuthority";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import {
  ProviderSessionDirectory,
  type ProviderSessionDirectoryShape,
} from "../Services/ProviderSessionDirectory";
import { ProviderSessionReaper } from "../Services/ProviderSessionReaper";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService";
import { makeProviderSessionReaperLive } from "./ProviderSessionReaper";

const unsupported = () => Effect.die(new Error("Unsupported test call")) as never;

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for predicate");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function makeThreadShell(input: {
  readonly threadId: ThreadId;
  readonly activeTurnId: TurnId | null;
}): OrchestrationThreadShell {
  return {
    id: input.threadId,
    session: input.activeTurnId
      ? {
          activeTurnId: input.activeTurnId,
        }
      : null,
  } as unknown as OrchestrationThreadShell;
}

function makeLayer(input: {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly threadShell: OrchestrationThreadShell;
  readonly directory: ProviderSessionDirectoryShape;
  readonly providerService: ProviderServiceShape;
}) {
  return makeProviderSessionReaperLive({
    inactivityThresholdMs: 1,
    sweepIntervalMs: 60_000,
  }).pipe(
    Layer.provide(Layer.succeed(ExecutionAdapterAuthority, input.authority)),
    Layer.provide(Layer.succeed(ProviderSessionDirectory, input.directory)),
    Layer.provide(Layer.succeed(ProviderService, input.providerService)),
    Layer.provide(
      Layer.succeed(ProjectionSnapshotQuery, {
        getSnapshot: () => unsupported(),
        getCommandReadModel: () => unsupported(),
        getCounts: () => unsupported(),
        getSnapshotSequence: () => unsupported(),
        getShellSnapshot: () => unsupported(),
        getActiveProjectByWorkspaceRoot: () => unsupported(),
        getProjectShellById: () => unsupported(),
        getFirstActiveThreadIdByProjectId: () => unsupported(),
        getThreadCheckpointContext: () => unsupported(),
        listGeneratedImageActivitiesByTurn: () => unsupported(),
        getFullThreadDiffContext: () => unsupported(),
        getThreadShellById: () => Effect.succeed(Option.some(input.threadShell)),
        findSyntheticSubagentParentThread: () => unsupported(),
        getThreadDetailById: () => unsupported(),
        getThreadDetailForExportById: () => unsupported(),
        getThreadDetailSnapshotById: () => unsupported(),
      }),
    ),
  );
}

function makeAuthority() {
  return Effect.runPromise(
    makeExecutionAdapterAuthority({
      persist: () => Effect.void,
      now: () => new Date("2026-07-25T00:00:00.000Z"),
    }),
  );
}

function authorityFailureReason(exit: Exit.Exit<unknown, unknown>): string | undefined {
  if (!Exit.isFailure(exit)) return undefined;
  return Option.getOrUndefined(
    Cause.findErrorOption(exit.cause) as Option.Option<{ reason: string }>,
  )?.reason;
}

describe("ProviderSessionReaperLive", () => {
  it("stops stale sessions without active turns", async () => {
    const threadId = ThreadId.makeUnsafe("thread-reaper-stale");
    const authority = await makeAuthority();
    const stopSession = vi.fn<ProviderServiceShape["stopSession"]>(() => Effect.void);
    const directory: ProviderSessionDirectoryShape = {
      upsert: () => Effect.void,
      getProvider: () => unsupported(),
      getBinding: () =>
        Effect.succeed(
          Option.some({
            threadId,
            provider: "codex",
            status: "running",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          }),
        ),
      remove: () => Effect.void,
      listThreadIds: () => Effect.succeed([]),
      listBindings: () =>
        Effect.succeed([
          {
            threadId,
            provider: "codex",
            status: "running",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
    };
    const providerService: ProviderServiceShape = {
      startSession: () => unsupported(),
      sendTurn: () => unsupported(),
      steerTurn: () => unsupported(),
      startReview: () => unsupported(),
      interruptTurn: () => unsupported(),
      respondToRequest: () => unsupported(),
      respondToUserInput: () => unsupported(),
      stopSession,
      adoptSessionResumeCursor: () => Effect.void,
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => unsupported(),
      rollbackConversation: () => unsupported(),
      compactThread: () => unsupported(),
      streamEvents: Stream.empty,
    };

    const scope = await Effect.runPromise(Scope.make());
    try {
      await Effect.gen(function* () {
        const reaper = yield* ProviderSessionReaper;
        yield* Scope.provide(reaper.start(), scope);
      }).pipe(
        Effect.provide(
          makeLayer({
            authority,
            threadShell: makeThreadShell({ threadId, activeTurnId: null }),
            directory,
            providerService,
          }),
        ),
        Effect.runPromise,
      );
      await waitFor(() => stopSession.mock.calls.length === 1);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }

    expect(stopSession).toHaveBeenCalledWith({ threadId });
  });

  it("skips stale sessions with active turns", async () => {
    const threadId = ThreadId.makeUnsafe("thread-reaper-active");
    const turnId = TurnId.makeUnsafe("turn-reaper-active");
    const authority = await makeAuthority();
    const stopSession = vi.fn<ProviderServiceShape["stopSession"]>(() => Effect.void);
    const directory: ProviderSessionDirectoryShape = {
      upsert: () => Effect.void,
      getProvider: () => unsupported(),
      getBinding: () =>
        Effect.succeed(
          Option.some({
            threadId,
            provider: "codex",
            status: "running",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          }),
        ),
      remove: () => Effect.void,
      listThreadIds: () => Effect.succeed([]),
      listBindings: () =>
        Effect.succeed([
          {
            threadId,
            provider: "codex",
            status: "running",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
    };
    const providerService: ProviderServiceShape = {
      startSession: () => unsupported(),
      sendTurn: () => unsupported(),
      steerTurn: () => unsupported(),
      startReview: () => unsupported(),
      interruptTurn: () => unsupported(),
      respondToRequest: () => unsupported(),
      respondToUserInput: () => unsupported(),
      stopSession,
      adoptSessionResumeCursor: () => Effect.void,
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => unsupported(),
      rollbackConversation: () => unsupported(),
      compactThread: () => unsupported(),
      streamEvents: Stream.empty,
    };

    const scope = await Effect.runPromise(Scope.make());
    try {
      await Effect.gen(function* () {
        const reaper = yield* ProviderSessionReaper;
        yield* Scope.provide(reaper.start(), scope);
      }).pipe(
        Effect.provide(
          makeLayer({
            authority,
            threadShell: makeThreadShell({ threadId, activeTurnId: turnId }),
            directory,
            providerService,
          }),
        ),
        Effect.runPromise,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }

    expect(stopSession).not.toHaveBeenCalled();
  });

  it("skips stale providers when terminal owns the thread", async () => {
    const threadId = ThreadId.makeUnsafe("thread-reaper-terminal");
    const authority = await makeAuthority();
    await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-terminal",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    const stopSession = vi.fn<ProviderServiceShape["stopSession"]>(() => Effect.void);
    const staleBinding = {
      threadId,
      provider: "codex" as const,
      status: "running" as const,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    };
    const directory: ProviderSessionDirectoryShape = {
      upsert: () => Effect.void,
      getProvider: () => unsupported(),
      getBinding: () => Effect.succeed(Option.some(staleBinding)),
      remove: () => Effect.void,
      listThreadIds: () => Effect.succeed([]),
      listBindings: () => Effect.succeed([staleBinding]),
    };
    const providerService = {
      stopSession,
      streamEvents: Stream.empty,
    } as unknown as ProviderServiceShape;

    const scope = await Effect.runPromise(Scope.make());
    try {
      await Effect.gen(function* () {
        const reaper = yield* ProviderSessionReaper;
        yield* Scope.provide(reaper.start(), scope);
      }).pipe(
        Effect.provide(
          makeLayer({
            authority,
            threadShell: makeThreadShell({ threadId, activeTurnId: null }),
            directory,
            providerService,
          }),
        ),
        Effect.runPromise,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }

    expect(stopSession).not.toHaveBeenCalled();
  });

  it("revalidates freshness and holds the lease through provider stop", async () => {
    const threadId = ThreadId.makeUnsafe("thread-reaper-race");
    const authority = await makeAuthority();
    const stopGate = await Effect.runPromise(Deferred.make<void>());
    let fresh = true;
    const staleBinding = {
      threadId,
      provider: "codex" as const,
      status: "running" as const,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    };
    const directory: ProviderSessionDirectoryShape = {
      upsert: () => Effect.void,
      getProvider: () => unsupported(),
      getBinding: () =>
        Effect.succeed(
          Option.some({
            ...staleBinding,
            lastSeenAt: fresh ? "2999-01-01T00:00:00.000Z" : staleBinding.lastSeenAt,
          }),
        ),
      remove: () => Effect.void,
      listThreadIds: () => Effect.succeed([]),
      listBindings: () => Effect.succeed([staleBinding]),
    };
    const stopSession = vi.fn<ProviderServiceShape["stopSession"]>(() => Deferred.await(stopGate));
    const providerService = {
      stopSession,
      streamEvents: Stream.empty,
    } as unknown as ProviderServiceShape;

    const firstScope = await Effect.runPromise(Scope.make());
    try {
      await Effect.gen(function* () {
        const reaper = yield* ProviderSessionReaper;
        yield* Scope.provide(reaper.start(), firstScope);
      }).pipe(
        Effect.provide(
          makeLayer({
            authority,
            threadShell: makeThreadShell({ threadId, activeTurnId: null }),
            directory,
            providerService,
          }),
        ),
        Effect.runPromise,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(stopSession).not.toHaveBeenCalled();
    } finally {
      await Effect.runPromise(Scope.close(firstScope, Exit.void));
    }

    fresh = false;
    const secondScope = await Effect.runPromise(Scope.make());
    try {
      await Effect.gen(function* () {
        const reaper = yield* ProviderSessionReaper;
        yield* Scope.provide(reaper.start(), secondScope);
      }).pipe(
        Effect.provide(
          makeLayer({
            authority,
            threadShell: makeThreadShell({ threadId, activeTurnId: null }),
            directory,
            providerService,
          }),
        ),
        Effect.runPromise,
      );
      await waitFor(() => stopSession.mock.calls.length === 1);
      const blocked = await Effect.runPromiseExit(
        authority.beginTerminalSwitch({
          threadId,
          provider: "codex",
          runtimeInstanceId: "runtime-race",
          providerSessionId: null,
          startedAt: "2026-07-25T00:00:00.000Z",
        }),
      );
      expect(authorityFailureReason(blocked)).toBe("structured-operation-active");
      await Effect.runPromise(Deferred.succeed(stopGate, undefined));
    } finally {
      await Effect.runPromise(Scope.close(secondScope, Exit.void));
    }
  });
});
