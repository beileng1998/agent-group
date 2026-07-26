// FILE: ProviderRuntimeIngestion.ts
// Purpose: Composes provider runtime event ingestion without owning domain-specific projections.
// Layer: Server orchestration ingestion
// Exports: ProviderRuntimeIngestionLive and compatibility helper seams.

import type { ProviderRuntimeEvent } from "@agent-group/contracts";
import { Cause, Effect, Layer, Result, Stream } from "effect";
import { makeDrainableWorker } from "@agent-group/shared/DrainableWorker";
import * as Semaphore from "effect/Semaphore";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ServerConfig } from "../../config.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ExecutionAdapterAuthority } from "../Services/ExecutionAdapterAuthority.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderRuntimeIngestionService,
  type ProviderRuntimeIngestionShape,
} from "../Services/ProviderRuntimeIngestion.ts";
import { makeProviderRuntimeAssistantMessages } from "../providerRuntimeAssistantMessages.ts";
import { makeProviderRuntimeBufferState } from "../providerRuntimeBufferState.ts";
import { makeProviderRuntimeBuffers } from "../providerRuntimeBuffers.ts";
import { makeProviderRuntimeDiff } from "../providerRuntimeDiff.ts";
import { makeProviderRuntimeEventProcessor } from "../providerRuntimeEventProcessor.ts";
import { makeProviderRuntimeEventProjection } from "../providerRuntimeEventProjection.ts";
import { makeProviderRuntimeGeneratedImages } from "../providerRuntimeGeneratedImages.ts";
import { makeProviderRuntimeLifecycle } from "../providerRuntimeLifecycle.ts";
import { makeProviderRuntimePlans } from "../providerRuntimePlans.ts";
import { makeProviderRuntimeQueries } from "../providerRuntimeQueries.ts";
import { makeProviderRuntimeSessionCleanup } from "../providerRuntimeSessionCleanup.ts";
import { makeProviderRuntimeSubagentRouting } from "../providerRuntimeSubagentRouting.ts";
import { makeProviderRuntimeUpdateDispatch } from "../providerRuntimeUpdateDispatch.ts";
import { makeProviderRuntimeVisualizations } from "../providerRuntimeVisualizations.ts";
import type { RuntimeIngestionInput } from "../providerRuntimeIngestionValues.ts";

export { appendCappedBufferedText } from "../providerRuntimeBufferValues.ts";
export { collectPersistedGeneratedImagePaths } from "../providerRuntimeGeneratedImages.ts";

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const executionAdapterAuthority = yield* ExecutionAdapterAuthority;
  const providerService = yield* ProviderService;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const serverConfig = yield* ServerConfig;
  const state = yield* makeProviderRuntimeBufferState;

  const updates = makeProviderRuntimeUpdateDispatch({ orchestrationEngine, state });
  const queries = makeProviderRuntimeQueries({ projectionSnapshotQuery, providerService });
  const buffers = makeProviderRuntimeBuffers({
    state,
    dispatchActivityUpdate: updates.dispatchActivityUpdate,
  });
  const assistants = makeProviderRuntimeAssistantMessages({ orchestrationEngine, state });
  const visualizations = makeProviderRuntimeVisualizations({
    stateDir: serverConfig.stateDir,
    getProjectShell: queries.getProjectShell,
  });
  const plans = makeProviderRuntimePlans({
    orchestrationEngine,
    projectionTurnRepository,
    providerService,
    getThreadDetail: queries.getThreadDetail,
    buffers,
  });
  const images = makeProviderRuntimeGeneratedImages({
    orchestrationEngine,
    projectionSnapshotQuery,
    state,
    getProjectShell: queries.getProjectShell,
  });
  const diff = makeProviderRuntimeDiff({
    orchestrationEngine,
    state,
    isGitRepoForThread: queries.isGitRepoForThread,
    supportsLiveTurnDiffPatch: queries.supportsLiveTurnDiffPatch,
  });
  const cleanup = makeProviderRuntimeSessionCleanup({
    state,
    clearAssistantMessageState: assistants.clearAssistantMessageState,
  });
  const routing = makeProviderRuntimeSubagentRouting({
    orchestrationEngine,
    projectionSnapshotQuery,
  });
  const lifecycle = makeProviderRuntimeLifecycle({ orchestrationEngine, plans });
  const projection = makeProviderRuntimeEventProjection({
    orchestrationEngine,
    state,
    assistants,
    buffers,
    images,
    plans,
    diff,
    cleanup,
    visualizations,
  });
  const processor = makeProviderRuntimeEventProcessor({
    orchestrationEngine,
    state,
    queries,
    routing,
    lifecycle,
    projection,
    diff,
    buffers,
    assistants,
    updates,
  });

  // Adapter callbacks may arrive after suspension. Lease structured ownership
  // before any projection and retain it until every derived command commits.
  const processStructuredRuntimeEvent = (event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      const claimId = `provider-runtime:${event.provider}:${event.eventId}`;
      const claimed = yield* Effect.result(
        executionAdapterAuthority.acquireStructured(event.threadId, claimId),
      );
      if (Result.isFailure(claimed)) {
        if (claimed.failure.reason !== "not-structured") {
          return yield* Effect.fail(claimed.failure);
        }
        yield* Effect.logDebug("provider runtime ingestion ignored non-owning structured event", {
          threadId: event.threadId,
          provider: event.provider,
          eventId: event.eventId,
          eventType: event.type,
        });
        return;
      }
      yield* processor.processRuntimeEvent(event).pipe(Effect.ensuring(claimed.success.release));
    });
  const processInput = (input: RuntimeIngestionInput) =>
    input.source === "runtime"
      ? input.event.terminalRuntimeFence
        ? processor.processRuntimeEvent(input.event)
        : processStructuredRuntimeEvent(input.event)
      : processor.processDomainEvent(input.event);
  const processLock = yield* Semaphore.make(1);
  const processInputSerially = (input: RuntimeIngestionInput) =>
    processLock.withPermits(1)(processInput(input));
  const processInputSafely = (input: RuntimeIngestionInput) =>
    processInputSerially(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logWarning("provider runtime ingestion failed to process event", {
          source: input.source,
          eventId: input.event.eventId,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );
  const worker = yield* makeDrainableWorker(processInputSafely);
  const start: ProviderRuntimeIngestionShape["start"] = Effect.gen(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(providerService.streamEvents, (event) =>
        worker.enqueue({ source: "runtime", event }),
      ),
    );
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.turn-start-requested" &&
          event.type !== "thread.reverted" &&
          event.type !== "thread.conversation-rolled-back"
        ) {
          return Effect.void;
        }
        return worker.enqueue({ source: "domain", event });
      }),
    );
  });
  const publishTerminal: ProviderRuntimeIngestionShape["publishTerminal"] = (event) =>
    worker.drain.pipe(
      Effect.andThen(processInputSafely({ source: "runtime", event })),
      Effect.orDie,
    );
  return { start, drain: worker.drain, publishTerminal } satisfies ProviderRuntimeIngestionShape;
});

export const ProviderRuntimeIngestionLive = Layer.effect(
  ProviderRuntimeIngestionService,
  make,
).pipe(Layer.provide(ProjectionTurnRepositoryLive));
