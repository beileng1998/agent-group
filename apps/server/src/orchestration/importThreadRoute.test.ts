import {
  ProjectId,
  ThreadId,
  type OrchestrationThread,
  type ProviderSession,
} from "@agent-group/contracts";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery";
import type { ProviderAdapterRegistryShape } from "../provider/Services/ProviderAdapterRegistry";
import type { ProviderServiceShape } from "../provider/Services/ProviderService";
import { makeExecutionAdapterAuthority } from "./Layers/ExecutionAdapterAuthority";
import {
  type ExecutionAdapterAuthorityError,
  type ExecutionAdapterAuthorityShape,
} from "./Services/ExecutionAdapterAuthority";
import { makeImportThreadHandler, type ImportThreadHandlerOptions } from "./importThreadRoute";

const threadId = ThreadId.makeUnsafe("thread-import-authority");
const projectId = ProjectId.makeUnsafe("project-import-authority");

const importedThread = {
  id: threadId,
  projectId,
  session: null,
  modelSelection: { provider: "droid", model: "claude-opus-4-8" },
  runtimeMode: "full-access",
} as OrchestrationThread;

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
    Cause.findErrorOption(exit.cause) as Option.Option<ExecutionAdapterAuthorityError>,
  )?.reason;
}

function makeHandler(input: {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly dispatch: OrchestrationEngineShape["dispatch"];
  readonly getThread: ProjectionSnapshotQueryShape["getThreadDetailById"];
  readonly providerService: ProviderServiceShape;
}) {
  const projectionSnapshotQuery = {
    getThreadDetailById: input.getThread,
    getProjectShellById: () => Effect.succeed(Option.none()),
  } as unknown as ProjectionSnapshotQueryShape;
  const adapterRegistry = {
    getByProvider: () =>
      Effect.succeed({
        readExternalThread: () =>
          Effect.succeed({
            threadId,
            turns: [],
          }),
      }),
  } as unknown as ProviderAdapterRegistryShape;

  return makeImportThreadHandler({
    executionAdapterAuthority: input.authority,
    fileSystem: {} as ImportThreadHandlerOptions["fileSystem"],
    orchestrationEngine: {
      dispatch: input.dispatch,
      streamDomainEvents: Stream.empty,
    } as unknown as OrchestrationEngineShape,
    path: {} as ImportThreadHandlerOptions["path"],
    platform: "linux",
    projectionSnapshotQuery,
    providerAdapterRegistry: adapterRegistry,
    providerService: input.providerService,
  });
}

describe("makeImportThreadHandler authority", () => {
  it("fails closed before inspection when terminal owns the thread", async () => {
    const authority = await makeAuthority();
    await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "droid",
        runtimeInstanceId: "terminal-import",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    const getThread = vi.fn<ProjectionSnapshotQueryShape["getThreadDetailById"]>(() =>
      Effect.succeed(Option.some(importedThread)),
    );
    const handler = makeHandler({
      authority,
      dispatch: () => Effect.succeed({ sequence: 1 }),
      getThread,
      providerService: {} as ProviderServiceShape,
    });

    const exit = await Effect.runPromiseExit(handler({ threadId, externalId: "external-1" }));

    expect(authorityFailureReason(exit)).toBe("not-structured");
    expect(getThread).not.toHaveBeenCalled();
  });

  it("holds the claim through projection failure and rolls back the provider binding", async () => {
    const authority = await makeAuthority();
    const projectionStarted = await Effect.runPromise(Deferred.make<void>());
    const failProjection = await Effect.runPromise(Deferred.make<void>());
    const session: ProviderSession = {
      provider: "droid",
      status: "ready",
      runtimeMode: "full-access",
      threadId,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    const stopSession = vi.fn<ProviderServiceShape["stopSession"]>(() => Effect.void);
    const dispatch = (() =>
      Deferred.succeed(projectionStarted, undefined).pipe(
        Effect.andThen(Deferred.await(failProjection)),
        Effect.andThen(Effect.fail(new Error("projection failed"))),
      )) as unknown as OrchestrationEngineShape["dispatch"];
    const handler = makeHandler({
      authority,
      dispatch,
      getThread: () => Effect.succeed(Option.some(importedThread)),
      providerService: {
        startSession: () => Effect.succeed(session),
        stopSession,
      } as unknown as ProviderServiceShape,
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const importFiber = yield* handler({
          threadId,
          externalId: "external-2",
        }).pipe(Effect.forkChild);
        yield* Deferred.await(projectionStarted);

        const blocked = yield* Effect.exit(
          authority.beginTerminalSwitch({
            threadId,
            provider: "droid",
            runtimeInstanceId: "terminal-race",
            providerSessionId: null,
            startedAt: "2026-07-25T00:00:00.000Z",
          }),
        );
        expect(authorityFailureReason(blocked)).toBe("structured-operation-active");

        yield* Deferred.succeed(failProjection, undefined);
        const importExit = yield* Fiber.await(importFiber);
        expect(Exit.isFailure(importExit)).toBe(true);
      }),
    );

    expect(stopSession).toHaveBeenCalledOnce();
    expect(stopSession).toHaveBeenCalledWith({ threadId });
    const switched = await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "droid",
        runtimeInstanceId: "terminal-after-import",
        providerSessionId: null,
        startedAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    expect(switched.adapter).toBe("terminal");
  });
});
