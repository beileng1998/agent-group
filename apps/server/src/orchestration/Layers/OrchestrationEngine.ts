import type { OrchestrationEvent, OrchestrationReadModel } from "@agent-group/contracts";
import { Effect, Layer, PubSub, Queue, Semaphore, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { createEmptyReadModel } from "../projector.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { makeCommandDispatch } from "./orchestration-engine/commandDispatch.ts";
import { makeCommandProcessor } from "./orchestration-engine/commandProcessor.ts";
import type {
  CommandEnvelope,
  CommandReadModelState,
} from "./orchestration-engine/commandRuntime.ts";
import { makeDeciderReadModel } from "./orchestration-engine/deciderReadModel.ts";
import { makeDeferredProjectionRecovery } from "./orchestration-engine/deferredProjectionRecovery.ts";
import { makeRepairStateController } from "./orchestration-engine/repairStateController.ts";

const makeOrchestrationEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* OrchestrationEventStore;
  const commandReceiptRepository = yield* OrchestrationCommandReceiptRepository;
  const projectionPipeline = yield* OrchestrationProjectionPipeline;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  let currentCommandReadModel: OrchestrationReadModel = createEmptyReadModel(
    new Date().toISOString(),
  );
  const commandReadModel: CommandReadModelState = {
    get: () => currentCommandReadModel,
    set: (model) => {
      currentCommandReadModel = model;
    },
  };

  const commandQueue = yield* Queue.unbounded<CommandEnvelope>();
  const eventPubSub = yield* PubSub.unbounded<OrchestrationEvent>();
  const maintenanceLock = yield* Semaphore.make(1);
  const deferredProjection = yield* makeDeferredProjectionRecovery({
    projectionPipeline,
    maintenanceLock,
  });
  const deciderReadModel = makeDeciderReadModel({
    projectionSnapshotQuery,
    commandReadModel,
  });
  const processEnvelope = makeCommandProcessor({
    sql,
    eventStore,
    commandReceiptRepository,
    projectionPipeline,
    eventPubSub,
    maintenanceLock,
    commandReadModel,
    buildDeciderReadModel: deciderReadModel.build,
    projectDeferredEvents: deferredProjection.projectCommittedEvents,
  });

  yield* projectionPipeline.bootstrap;
  commandReadModel.set(yield* projectionSnapshotQuery.getCommandReadModel());

  const worker = Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope)));
  yield* Effect.forkScoped(worker);
  yield* Effect.log("orchestration engine started").pipe(
    Effect.annotateLogs({ sequence: commandReadModel.get().snapshotSequence }),
  );

  const readEvents: OrchestrationEngineShape["readEvents"] = (fromSequenceExclusive) =>
    eventStore.readFromSequence(fromSequenceExclusive);
  const getReadModel = () => Effect.sync(commandReadModel.get);
  const refreshCommandReadModel: OrchestrationEngineShape["refreshCommandReadModel"] = () =>
    maintenanceLock.withPermits(1)(deciderReadModel.refresh);
  const dispatch = makeCommandDispatch(commandQueue);
  const repairState = makeRepairStateController({
    sql,
    maintenanceLock,
    projectionPipeline,
    commandReadModel,
    refreshCommandReadModel: deciderReadModel.refresh,
  });

  return {
    getReadModel,
    refreshCommandReadModel,
    readEvents,
    dispatch,
    repairState,
    // Each access creates a fresh PubSub subscription so every consumer independently
    // receives all domain events.
    get streamDomainEvents(): OrchestrationEngineShape["streamDomainEvents"] {
      return Stream.fromPubSub(eventPubSub);
    },
  } satisfies OrchestrationEngineShape;
});

export const OrchestrationEngineLive = Layer.effect(
  OrchestrationEngineService,
  makeOrchestrationEngine,
);
