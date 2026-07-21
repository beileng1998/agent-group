import type { OrchestrationEvent } from "@agent-group/contracts";
import { Effect, FileSystem, Option, Path, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../../config.ts";
import { toPersistenceSqlError } from "../../../persistence/Errors.ts";
import { OrchestrationEventStore } from "../../../persistence/Services/OrchestrationEventStore.ts";
import { ProjectionProjectRepository } from "../../../persistence/Services/ProjectionProjects.ts";
import { ProjectionStateRepository } from "../../../persistence/Services/ProjectionState.ts";
import type { OrchestrationProjectionPipelineShape } from "../../Services/ProjectionPipeline.ts";
import {
  advanceProjectMetadataSnapshotState,
  applyProjectMetadataProjection,
} from "../../projectMetadataProjection.ts";
import { runAttachmentSideEffects } from "./attachmentSideEffects.ts";
import {
  ORCHESTRATION_PROJECTOR_NAMES,
  REQUIRED_SNAPSHOT_PROJECTORS,
  selectProjectorsForEvent,
  type AttachmentSideEffects,
  type ProjectorDefinition,
  type ProjectorName,
} from "./projectorDefinitions.ts";

export const makeProjectionPipelineRuntime = (projectors: ReadonlyArray<ProjectorDefinition>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventStore = yield* OrchestrationEventStore;
    const stateRepository = yield* ProjectionStateRepository;
    const projectRepository = yield* ProjectionProjectRepository;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;

    const runProjectorsForEvent = (
      selectedProjectors: ReadonlyArray<ProjectorDefinition>,
      event: OrchestrationEvent,
      phaseCursor?: ProjectorName,
    ) =>
      Effect.gen(function* () {
        if (selectedProjectors.length === 0 && phaseCursor === undefined) return;
        const attachmentSideEffects: AttachmentSideEffects = {
          deletedThreadIds: new Set<string>(),
          prunedThreadRelativePaths: new Map<string, Set<string>>(),
        };
        yield* sql.withTransaction(
          Effect.forEach(
            selectedProjectors,
            (projector) =>
              projector.apply(event, attachmentSideEffects).pipe(
                Effect.flatMap(() =>
                  projector.name === phaseCursor
                    ? Effect.void
                    : stateRepository.upsert({
                        projector: projector.name,
                        lastAppliedSequence: event.sequence,
                        updatedAt: event.occurredAt,
                      }),
                ),
              ),
            { concurrency: 1 },
          ).pipe(
            Effect.flatMap(() =>
              phaseCursor === undefined
                ? Effect.void
                : stateRepository.upsert({
                    projector: phaseCursor,
                    lastAppliedSequence: event.sequence,
                    updatedAt: event.occurredAt,
                  }),
            ),
          ),
        );
        yield* runAttachmentSideEffects(attachmentSideEffects).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("failed to apply projected attachment side-effects", {
              projectors: selectedProjectors.map((projector) => projector.name),
              sequence: event.sequence,
              eventType: event.type,
              cause,
            }),
          ),
        );
      });

    const runProjectorForEvent = (projector: ProjectorDefinition, event: OrchestrationEvent) =>
      runProjectorsForEvent([projector], event);

    const initializeHotProjectionCursor = Effect.gen(function* () {
      const hotProjectorNames = new Set(
        projectors
          .filter((projector) => projector.phase === "hot")
          .map((projector) => projector.name),
      );
      const sourceRows = (yield* stateRepository.listAll()).filter((row) =>
        hotProjectorNames.has(row.projector as ProjectorName),
      );
      if (sourceRows.length === 0) return;
      const oldestCursor = sourceRows.reduce((oldest, row) =>
        row.lastAppliedSequence < oldest.lastAppliedSequence ? row : oldest,
      );
      yield* stateRepository.upsert({
        projector: ORCHESTRATION_PROJECTOR_NAMES.hot,
        lastAppliedSequence: oldestCursor.lastAppliedSequence,
        updatedAt: oldestCursor.updatedAt,
      });
    });

    const fastForwardHotProjectorCursors = Effect.gen(function* () {
      const stateRows = yield* stateRepository.listAll();
      const stateByProjector = new Map(stateRows.map((row) => [row.projector, row] as const));
      const hotState = stateByProjector.get(ORCHESTRATION_PROJECTOR_NAMES.hot);
      if (!hotState) return;
      const laggingProjectors = projectors.filter((projector) => {
        if (projector.phase !== "hot") return false;
        const projectorState = stateByProjector.get(projector.name);
        return (
          projectorState !== undefined &&
          projectorState.lastAppliedSequence < hotState.lastAppliedSequence
        );
      });
      if (laggingProjectors.length === 0) return;
      yield* sql.withTransaction(
        Effect.forEach(
          laggingProjectors,
          (projector) =>
            stateRepository.upsert({
              projector: projector.name,
              lastAppliedSequence: hotState.lastAppliedSequence,
              updatedAt: hotState.updatedAt,
            }),
          { concurrency: 1 },
        ),
      );
    });

    const advanceProjectorStateToEvent = (
      projector: ProjectorDefinition,
      event: OrchestrationEvent,
    ) =>
      stateRepository.upsert({
        projector: projector.name,
        lastAppliedSequence: event.sequence,
        updatedAt: event.occurredAt,
      });

    const bootstrapProjector = (projector: ProjectorDefinition) =>
      stateRepository.getByProjector({ projector: projector.name }).pipe(
        Effect.flatMap((stateRow) =>
          Effect.gen(function* () {
            let pendingSkippedEvent: OrchestrationEvent | null = null;
            yield* Stream.runForEach(
              eventStore.readFromSequence(
                Option.isSome(stateRow) ? stateRow.value.lastAppliedSequence : 0,
              ),
              (event) => {
                if (!(projector.shouldApply?.(event) ?? true)) {
                  pendingSkippedEvent = event;
                  return Effect.void;
                }
                pendingSkippedEvent = null;
                return runProjectorForEvent(projector, event);
              },
            );
            if (pendingSkippedEvent) {
              yield* advanceProjectorStateToEvent(projector, pendingSkippedEvent);
            }
          }),
        ),
      );

    const advanceSnapshotProjectorStates = (event: OrchestrationEvent) =>
      sql.withTransaction(
        Effect.forEach(
          REQUIRED_SNAPSHOT_PROJECTORS,
          (projector) =>
            stateRepository.upsert({
              projector,
              lastAppliedSequence: event.sequence,
              updatedAt: event.occurredAt,
            }),
          { concurrency: 1 },
        ),
      );

    const projectMetadataEvent: OrchestrationProjectionPipelineShape["projectMetadataEvent"] = (
      event,
    ) =>
      applyProjectMetadataProjection({
        event,
        projectionProjectRepository: projectRepository,
      }).pipe(
        Effect.flatMap(() =>
          advanceProjectMetadataSnapshotState({
            event,
            projectionStateRepository: stateRepository,
          }),
        ),
        Effect.asVoid,
      );

    const projectEvent: OrchestrationProjectionPipelineShape["projectEvent"] = (event) =>
      runProjectorsForEvent(
        selectProjectorsForEvent(projectors, event, "hot"),
        event,
        ORCHESTRATION_PROJECTOR_NAMES.hot,
      ).pipe(
        Effect.flatMap(() =>
          runProjectorsForEvent(
            selectProjectorsForEvent(projectors, event, "deferred"),
            event,
            ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries,
          ),
        ),
        Effect.flatMap(() => {
          switch (event.type) {
            case "project.created":
            case "project.meta-updated":
            case "project.deleted":
              return advanceSnapshotProjectorStates(event);
            default:
              return Effect.void;
          }
        }),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ServerConfig, serverConfig),
        Effect.asVoid,
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(toPersistenceSqlError("ProjectionPipeline.projectEvent:query")(sqlError)),
        ),
      );

    const projectHotEvent: OrchestrationProjectionPipelineShape["projectHotEvent"] = (event) =>
      runProjectorsForEvent(
        selectProjectorsForEvent(projectors, event, "hot"),
        event,
        ORCHESTRATION_PROJECTOR_NAMES.hot,
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ServerConfig, serverConfig),
        Effect.asVoid,
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(toPersistenceSqlError("ProjectionPipeline.projectHotEvent:query")(sqlError)),
        ),
      );

    const projectDeferredEvent: OrchestrationProjectionPipelineShape["projectDeferredEvent"] = (
      event,
    ) =>
      runProjectorsForEvent(
        selectProjectorsForEvent(projectors, event, "deferred"),
        event,
        ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries,
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ServerConfig, serverConfig),
        Effect.asVoid,
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(
            toPersistenceSqlError("ProjectionPipeline.projectDeferredEvent:query")(sqlError),
          ),
        ),
      );

    const bootstrap: OrchestrationProjectionPipelineShape["bootstrap"] =
      fastForwardHotProjectorCursors.pipe(
        Effect.flatMap(() => Effect.forEach(projectors, bootstrapProjector, { concurrency: 1 })),
        Effect.flatMap(() => initializeHotProjectionCursor),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ServerConfig, serverConfig),
        Effect.asVoid,
        Effect.tap(() =>
          Effect.log("orchestration projection pipeline bootstrapped").pipe(
            Effect.annotateLogs({ projectors: projectors.length }),
          ),
        ),
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(toPersistenceSqlError("ProjectionPipeline.bootstrap:query")(sqlError)),
        ),
      );

    return {
      bootstrap,
      projectEvent,
      projectHotEvent,
      projectDeferredEvent,
      projectMetadataEvent,
    } satisfies OrchestrationProjectionPipelineShape;
  });
