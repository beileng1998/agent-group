import type { OrchestrationProject, OrchestrationThread } from "@agent-group/contracts";
import { Effect } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../../../persistence/Errors.ts";
import type { ProjectionSnapshotQueryShape } from "../../Services/ProjectionSnapshotQuery.ts";
import {
  collectBaseUpdatedAt,
  collectProjectedActivities,
  collectProjectedCheckpoints,
  collectProjectedLatestTurns,
  collectProjectedMessages,
  collectProjectedProposedPlans,
  collectProjectedSessions,
  computeSnapshotSequence,
  maxOptionalIso,
} from "./projectionSnapshotCollections.ts";
import { decodeReadModel, decodeShellSnapshot } from "./projectionSnapshotDecoders.ts";
import { toPersistenceSqlOrDecodeError } from "./projectionSnapshotErrors.ts";
import {
  toProjectedProject,
  toProjectedProjectShell,
  toProjectedThread,
  toProjectedThreadShellFromStoredSummary,
} from "./projectionSnapshotProjection.ts";
import {
  decodeProjectionProjectRows,
  decodeProjectionThreadRows,
  decodeProjectionThreadShellRows,
} from "./projectionSnapshotRows.ts";
import type { ProjectionQuerySet } from "./projectionQuerySet.ts";

export function makeSnapshotOperations(input: {
  readonly sql: SqlClient.SqlClient;
  readonly queries: ProjectionQuerySet;
}) {
  const { sql, queries } = input;
  const {
    listProjectRows,
    listThreadRows,
    listThreadShellRows,
    listThreadMessageRows,
    listThreadProposedPlanRows,
    listThreadActivityRows,
    listThreadSessionRows,
    listCheckpointRows,
    listLatestTurnRows,
    listProjectionStateRows,
  } = queries;

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            projectRows,
            threadRows,
            messageRows,
            proposedPlanRows,
            activityRows,
            sessionRows,
            checkpointRows,
            latestTurnRows,
            stateRows,
          ] = yield* Effect.all([
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows",
                ),
              ),
              Effect.flatMap((rows) =>
                decodeProjectionProjectRows(
                  rows,
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeModelSelections",
                ),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeRows",
                ),
              ),
              Effect.flatMap((rows) =>
                decodeProjectionThreadRows(
                  rows,
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeModelSelections",
                ),
              ),
            ),
            listThreadMessageRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows",
                ),
              ),
            ),
            listThreadProposedPlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listThreadActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows",
                ),
              ),
            ),
            listThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:decodeRows",
                ),
              ),
            ),
            listCheckpointRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query",
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows",
                ),
              ),
            ),
            listLatestTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);

          const messages = collectProjectedMessages(messageRows);
          const proposedPlans = collectProjectedProposedPlans(proposedPlanRows);
          const activities = collectProjectedActivities(activityRows);
          const checkpoints = collectProjectedCheckpoints(checkpointRows);
          const latestTurns = collectProjectedLatestTurns(latestTurnRows);
          const sessions = collectProjectedSessions(sessionRows);

          let updatedAt = collectBaseUpdatedAt({ projectRows, threadRows, stateRows });
          updatedAt = maxOptionalIso(updatedAt, messages.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, proposedPlans.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, activities.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, checkpoints.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, latestTurns.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, sessions.updatedAt);

          const projects: ReadonlyArray<OrchestrationProject> = projectRows.map(toProjectedProject);
          const threads: ReadonlyArray<OrchestrationThread> = threadRows.map((row) =>
            toProjectedThread({
              threadRow: row,
              latestTurn: latestTurns.byThread.get(row.threadId) ?? null,
              messages: messages.byThread.get(row.threadId) ?? [],
              proposedPlans: proposedPlans.byThread.get(row.threadId) ?? [],
              activities: activities.byThread.get(row.threadId) ?? [],
              checkpoints: checkpoints.byThread.get(row.threadId) ?? [],
              session: sessions.byThread.get(row.threadId) ?? null,
            }),
          );

          return yield* decodeReadModel({
            snapshotSequence: computeSnapshotSequence(stateRows),
            projects,
            threads,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          }).pipe(
            Effect.mapError(
              toPersistenceDecodeError("ProjectionSnapshotQuery.getSnapshot:decodeReadModel"),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error),
        ),
      );

  const getCommandReadModel: ProjectionSnapshotQueryShape["getCommandReadModel"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            projectRows,
            threadRows,
            proposedPlanRows,
            sessionRows,
            latestTurnRows,
            stateRows,
          ] = yield* Effect.all([
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listProjects:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listProjects:decodeRows",
                ),
              ),
              Effect.flatMap((rows) =>
                decodeProjectionProjectRows(
                  rows,
                  "ProjectionSnapshotQuery.getCommandReadModel:listProjects:decodeModelSelections",
                ),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreads:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreads:decodeRows",
                ),
              ),
              Effect.flatMap((rows) =>
                decodeProjectionThreadRows(
                  rows,
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreads:decodeModelSelections",
                ),
              ),
            ),
            listThreadProposedPlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreadSessions:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listThreadSessions:decodeRows",
                ),
              ),
            ),
            listLatestTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getCommandReadModel:listProjectionState:query",
                  "ProjectionSnapshotQuery.getCommandReadModel:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);

          const proposedPlans = collectProjectedProposedPlans(proposedPlanRows);
          const sessions = collectProjectedSessions(sessionRows);
          const latestTurns = collectProjectedLatestTurns(latestTurnRows);
          let updatedAt = collectBaseUpdatedAt({ projectRows, threadRows, stateRows });
          updatedAt = maxOptionalIso(updatedAt, proposedPlans.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, sessions.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, latestTurns.updatedAt);
          const projects: ReadonlyArray<OrchestrationProject> = projectRows.map(toProjectedProject);
          const threads: ReadonlyArray<OrchestrationThread> = threadRows.map((row) =>
            toProjectedThread({
              threadRow: row,
              latestTurn: latestTurns.byThread.get(row.threadId) ?? null,
              messages: [],
              proposedPlans: proposedPlans.byThread.get(row.threadId) ?? [],
              activities: [],
              checkpoints: [],
              session: sessions.byThread.get(row.threadId) ?? null,
            }),
          );
          return yield* decodeReadModel({
            snapshotSequence: computeSnapshotSequence(stateRows),
            projects,
            threads,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          }).pipe(
            Effect.mapError(
              toPersistenceDecodeError(
                "ProjectionSnapshotQuery.getCommandReadModel:decodeReadModel",
              ),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("ProjectionSnapshotQuery.getCommandReadModel:query")(error),
        ),
      );

  const getShellSnapshot: ProjectionSnapshotQueryShape["getShellSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [projectRows, threadRows, sessionRows, latestTurnRows, stateRows] =
            yield* Effect.all([
              listProjectRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listProjects:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listProjects:decodeRows",
                  ),
                ),
                Effect.flatMap((rows) =>
                  decodeProjectionProjectRows(
                    rows,
                    "ProjectionSnapshotQuery.getShellSnapshot:listProjects:decodeModelSelections",
                  ),
                ),
              ),
              listThreadShellRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listThreads:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listThreads:decodeRows",
                  ),
                ),
                Effect.flatMap((rows) =>
                  decodeProjectionThreadShellRows(
                    rows,
                    "ProjectionSnapshotQuery.getShellSnapshot:listThreads:decodeModelSelections",
                  ),
                ),
              ),
              listThreadSessionRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listThreadSessions:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listThreadSessions:decodeRows",
                  ),
                ),
              ),
              listLatestTurnRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listLatestTurns:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listLatestTurns:decodeRows",
                  ),
                ),
              ),
              listProjectionStateRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getShellSnapshot:listProjectionState:query",
                    "ProjectionSnapshotQuery.getShellSnapshot:listProjectionState:decodeRows",
                  ),
                ),
              ),
            ]);
          const latestTurns = collectProjectedLatestTurns(latestTurnRows);
          const sessions = collectProjectedSessions(sessionRows);
          let updatedAt = collectBaseUpdatedAt({ projectRows, threadRows, stateRows });
          updatedAt = maxOptionalIso(updatedAt, latestTurns.updatedAt);
          updatedAt = maxOptionalIso(updatedAt, sessions.updatedAt);
          return yield* decodeShellSnapshot({
            snapshotSequence: computeSnapshotSequence(stateRows),
            projects: projectRows
              .filter((row) => row.deletedAt === null)
              .map((row) => toProjectedProjectShell(row)),
            threads: threadRows
              .filter((row) => row.deletedAt === null)
              .map((row) =>
                toProjectedThreadShellFromStoredSummary({
                  threadRow: row,
                  latestTurn: latestTurns.byThread.get(row.threadId) ?? null,
                  session: sessions.byThread.get(row.threadId) ?? null,
                }),
              ),
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          }).pipe(
            Effect.mapError(
              toPersistenceDecodeError(
                "ProjectionSnapshotQuery.getShellSnapshot:decodeShellSnapshot",
              ),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("ProjectionSnapshotQuery.getShellSnapshot:query")(error),
        ),
      );

  return { getSnapshot, getCommandReadModel, getShellSnapshot };
}
