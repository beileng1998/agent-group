import type { OrchestrationEvent, OrchestrationReadModel } from "@agent-group/contracts";
import { Effect, Exit, Layer, PubSub, Queue, Semaphore, Stream } from "effect";
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
import { ExecutionAdapterAuthority } from "../Services/ExecutionAdapterAuthority.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { withProjectRuntimeGate } from "../projectRuntimeGate.ts";
import { makeCommandDispatch } from "./orchestration-engine/commandDispatch.ts";
import { makeCommandProcessor } from "./orchestration-engine/commandProcessor.ts";
import type {
  CommandEnvelope,
  CommandReadModelState,
} from "./orchestration-engine/commandRuntime.ts";
import { makeDeciderReadModel } from "./orchestration-engine/deciderReadModel.ts";
import { makeDeferredProjectionRecovery } from "./orchestration-engine/deferredProjectionRecovery.ts";
import { makeRepairStateController } from "./orchestration-engine/repairStateController.ts";
import { executionAdapterAdmissionForCommand } from "./orchestration-engine/executionAdapterCommandAdmission.ts";
import { withProjectStructuredAdmission } from "./orchestration-engine/executionAdapterProjectAdmission.ts";
import { ExecutionAdapterAuthorityMemoryLive } from "./ExecutionAdapterAuthorityMemoryLive.ts";

const makeOrchestrationEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* OrchestrationEventStore;
  const commandReceiptRepository = yield* OrchestrationCommandReceiptRepository;
  const projectionPipeline = yield* OrchestrationProjectionPipeline;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const executionAdapterAuthority = yield* ExecutionAdapterAuthority;

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
  const dispatchCommand = makeCommandDispatch(commandQueue);
  const dispatch: OrchestrationEngineShape["dispatch"] = (command) => {
    const admission = executionAdapterAdmissionForCommand(command);
    if (admission === null) return dispatchCommand(command);
    const mapAdmissionError = (cause: { readonly message: string }) =>
      new OrchestrationCommandInvariantError({
        commandType: command.type,
        detail: cause.message,
        cause,
      });
    if (admission.kind === "terminal-operation") {
      return Effect.acquireUseRelease(
        executionAdapterAuthority
          .acquireTerminal(
            admission.threadId,
            admission.revision,
            admission.generation,
            `command:${command.commandId}`,
          )
          .pipe(Effect.mapError(mapAdmissionError)),
        () => dispatchCommand(command),
        (claim) => claim.release,
      );
    }
    if (admission.kind === "project-structured-operation") {
      return withProjectRuntimeGate(
        admission.projectId,
        Effect.suspend(() =>
          withProjectStructuredAdmission({
            authority: executionAdapterAuthority,
            readModel: commandReadModel.get(),
            projectId: admission.projectId,
            claimId: admission.claimId,
            operation: dispatchCommand(command),
          }),
        ),
      ).pipe(Effect.mapError(mapAdmissionError));
    }
    if (admission.kind === "project-gated-operation") {
      return withProjectRuntimeGate(
        admission.projectId,
        dispatchCommand(command),
      );
    }
    if (admission.kind === "turn-start") {
      return executionAdapterAuthority
        .reserveStructuredStart(admission.threadId, admission.claimId)
        .pipe(
          Effect.mapError(mapAdmissionError),
          Effect.andThen(
            dispatchCommand(command).pipe(
              Effect.onExit((exit) =>
                Exit.isFailure(exit)
                  ? executionAdapterAuthority.releaseStructured(
                      admission.threadId,
                      admission.claimId,
                    )
                  : Effect.void,
              ),
            ),
          ),
        );
    }
    return Effect.acquireUseRelease(
      executionAdapterAuthority
        .acquireStructured(admission.threadId, admission.claimId)
        .pipe(Effect.mapError(mapAdmissionError)),
      () => dispatchCommand(command),
      (claim) => claim.release,
    );
  };
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

export const OrchestrationEngineCoreLive = Layer.effect(
  OrchestrationEngineService,
  makeOrchestrationEngine,
);

/** Test/default layer. Production composes Core with the shared durable authority. */
export const OrchestrationEngineLive = OrchestrationEngineCoreLive.pipe(
  Layer.provide(ExecutionAdapterAuthorityMemoryLive),
);
