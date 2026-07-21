import { Effect, Layer } from "effect";

import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import { makeCheckpointCaptureHandlers } from "./checkpoint-reactor/checkpointCaptureHandlers.ts";
import { makeCheckpointLookup } from "./checkpoint-reactor/checkpointLookup.ts";
import { makeCheckpointReactorRuntime } from "./checkpoint-reactor/checkpointReactorRuntime.ts";
import { makeCheckpointReactorState } from "./checkpoint-reactor/checkpointReactorValues.ts";
import { makeCheckpointRestoreHandler } from "./checkpoint-reactor/checkpointRestoreHandler.ts";
import { makeCheckpointStatus } from "./checkpoint-reactor/checkpointStatus.ts";
import { makeCheckpointTurnStartHandlers } from "./checkpoint-reactor/checkpointTurnStartHandlers.ts";

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const checkpointStore = yield* CheckpointStore;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const receiptBus = yield* RuntimeReceiptBus;

  const state = makeCheckpointReactorState();
  const lookup = makeCheckpointLookup({ projectionSnapshotQuery, providerService });
  const status = makeCheckpointStatus({ orchestrationEngine, projectionSnapshotQuery });
  const capture = makeCheckpointCaptureHandlers({
    checkpointStore,
    lookup,
    orchestrationEngine,
    receiptBus,
    status,
  });
  const turnStart = makeCheckpointTurnStartHandlers({
    capture,
    checkpointStore,
    lookup,
    projectionTurnRepository,
    state,
  });
  const restore = makeCheckpointRestoreHandler({
    checkpointStore,
    lookup,
    orchestrationEngine,
    providerService,
    status,
  });

  return yield* makeCheckpointReactorRuntime({
    capture,
    orchestrationEngine,
    providerService,
    restore,
    state,
    status,
    turnStart,
  });
});

export const CheckpointReactorLive = Layer.effect(CheckpointReactor, make).pipe(
  Layer.provide(ProjectionTurnRepositoryLive),
);
