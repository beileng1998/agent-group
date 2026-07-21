// FILE: ProviderRuntimeIngestion.ts
// Purpose: Composes provider runtime event ingestion without owning domain-specific projections.
// Layer: Server orchestration ingestion
// Exports: ProviderRuntimeIngestionLive and compatibility helper seams.

import { Cause, Effect, Layer, Stream } from "effect";
import { makeDrainableWorker } from "@agent-group/shared/DrainableWorker";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
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
import type { RuntimeIngestionInput } from "../providerRuntimeIngestionValues.ts";

export { appendCappedBufferedText } from "../providerRuntimeBufferValues.ts";
export { collectPersistedGeneratedImagePaths } from "../providerRuntimeGeneratedImages.ts";

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const state = yield* makeProviderRuntimeBufferState;

  const updates = makeProviderRuntimeUpdateDispatch({ orchestrationEngine, state });
  const queries = makeProviderRuntimeQueries({ projectionSnapshotQuery, providerService });
  const buffers = makeProviderRuntimeBuffers({
    state,
    dispatchActivityUpdate: updates.dispatchActivityUpdate,
  });
  const assistants = makeProviderRuntimeAssistantMessages({ orchestrationEngine, state });
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

  const processInput = (input: RuntimeIngestionInput) =>
    input.source === "runtime"
      ? processor.processRuntimeEvent(input.event)
      : processor.processDomainEvent(input.event);
  const processInputSafely = (input: RuntimeIngestionInput) =>
    processInput(input).pipe(
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
  return { start, drain: worker.drain } satisfies ProviderRuntimeIngestionShape;
});

export const ProviderRuntimeIngestionLive = Layer.effect(
  ProviderRuntimeIngestionService,
  make,
).pipe(Layer.provide(ProjectionTurnRepositoryLive));
