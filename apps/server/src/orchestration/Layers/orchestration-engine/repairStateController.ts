import type { OrchestrationReadModel } from "@agent-group/contracts";
import { ORCHESTRATION_WS_METHODS } from "@agent-group/contracts";
import { Cause, Effect, Semaphore } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import { OrchestrationCommandInternalError } from "../../Errors.ts";
import { PROJECT_METADATA_SNAPSHOT_PROJECTORS } from "../../projectMetadataProjection.ts";
import type { OrchestrationProjectionPipelineShape } from "../../Services/ProjectionPipeline.ts";
import type { OrchestrationEngineShape } from "../../Services/OrchestrationEngine.ts";
import type { CommandReadModelState } from "./commandRuntime.ts";

export const makeRepairStateController = (input: {
  readonly sql: SqlClient;
  readonly maintenanceLock: Semaphore.Semaphore;
  readonly projectionPipeline: OrchestrationProjectionPipelineShape;
  readonly commandReadModel: CommandReadModelState;
  readonly refreshCommandReadModel: Effect.Effect<
    OrchestrationReadModel,
    OrchestrationCommandInternalError
  >;
}): OrchestrationEngineShape["repairState"] => {
  const resetDerivedProjectionState = input.sql.withTransaction(
    Effect.gen(function* () {
      yield* input.sql`DELETE FROM projection_projects`;
      yield* input.sql`
        DELETE FROM projection_state
        WHERE projector IN ${input.sql.in(PROJECT_METADATA_SNAPSHOT_PROJECTORS)}
      `;
    }),
  );

  const backupDerivedProjectionState = input.sql.withTransaction(
    Effect.gen(function* () {
      yield* input.sql`DROP TABLE IF EXISTS temp_repair_projection_projects`;
      yield* input.sql`DROP TABLE IF EXISTS temp_repair_projection_state`;
      yield* input.sql`CREATE TEMP TABLE temp_repair_projection_projects AS SELECT * FROM projection_projects`;
      yield* input.sql`CREATE TEMP TABLE temp_repair_projection_state AS SELECT * FROM projection_state`;
    }),
  );

  const restoreDerivedProjectionState = input.sql.withTransaction(
    Effect.gen(function* () {
      yield* input.sql`DELETE FROM projection_projects`;
      yield* input.sql`INSERT INTO projection_projects SELECT * FROM temp_repair_projection_projects`;
      yield* input.sql`DELETE FROM projection_state`;
      yield* input.sql`INSERT INTO projection_state SELECT * FROM temp_repair_projection_state`;
    }),
  );

  const dropProjectionRepairBackup = input.sql.withTransaction(
    Effect.gen(function* () {
      yield* input.sql`DROP TABLE IF EXISTS temp_repair_projection_projects`;
      yield* input.sql`DROP TABLE IF EXISTS temp_repair_projection_state`;
    }),
  );

  return () =>
    input.maintenanceLock.withPermits(1)(
      Effect.gen(function* () {
        yield* Effect.log("repairing orchestration projection state");
        const previousCommandReadModel = input.commandReadModel.get();

        yield* backupDerivedProjectionState.pipe(
          Effect.catchTag("SqlError", (sqlError) =>
            Effect.logError("failed to back up derived orchestration projection state").pipe(
              Effect.annotateLogs({ cause: Cause.pretty(Cause.fail(sqlError)) }),
              Effect.flatMap(() =>
                Effect.fail(
                  new OrchestrationCommandInternalError({
                    commandId: "repair-local-state",
                    commandType: ORCHESTRATION_WS_METHODS.repairState,
                    detail: "Failed to stage the current local state before rebuilding it.",
                  }),
                ),
              ),
            ),
          ),
        );

        yield* resetDerivedProjectionState.pipe(
          Effect.catchTag("SqlError", (sqlError) =>
            Effect.logError("failed to reset derived orchestration projection state").pipe(
              Effect.annotateLogs({ cause: Cause.pretty(Cause.fail(sqlError)) }),
              Effect.tap(() =>
                restoreDerivedProjectionState.pipe(
                  Effect.catchCause(() =>
                    Effect.logWarning(
                      "failed to restore orchestration projection backup after reset failure",
                    ),
                  ),
                ),
              ),
              Effect.flatMap(() =>
                Effect.fail(
                  new OrchestrationCommandInternalError({
                    commandId: "repair-local-state",
                    commandType: ORCHESTRATION_WS_METHODS.repairState,
                    detail: "Failed to clear the local projection cache before rebuilding it.",
                  }),
                ),
              ),
            ),
          ),
        );

        const rebuildResult = yield* Effect.exit(input.projectionPipeline.bootstrap);
        if (rebuildResult._tag === "Failure") {
          yield* restoreDerivedProjectionState.pipe(
            Effect.catchCause(() =>
              Effect.logWarning(
                "failed to restore orchestration projection backup after rebuild failure",
              ),
            ),
          );
          input.commandReadModel.set(previousCommandReadModel);
          yield* dropProjectionRepairBackup.pipe(Effect.catchCause(() => Effect.void));

          return yield* Effect.logError(
            "failed to rebuild orchestration projections from event log",
          ).pipe(
            Effect.annotateLogs({ cause: Cause.pretty(rebuildResult.cause) }),
            Effect.flatMap(() =>
              Effect.fail(
                new OrchestrationCommandInternalError({
                  commandId: "repair-local-state",
                  commandType: ORCHESTRATION_WS_METHODS.repairState,
                  detail: "Failed to rebuild local projections from the saved event history.",
                }),
              ),
            ),
          );
        }

        const snapshot = yield* input.refreshCommandReadModel;
        yield* dropProjectionRepairBackup.pipe(Effect.catchCause(() => Effect.void));
        return snapshot;
      }),
    );
};
