import type {
  OrchestrationThread,
  OrchestrationThreadDetailSnapshot,
  OrchestrationThreadShell,
  ThreadId,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../../../persistence/Errors.ts";
import type { ProjectionSnapshotQueryShape } from "../../Services/ProjectionSnapshotQuery.ts";
import { computeSnapshotSequence } from "./projectionSnapshotCollections.ts";
import { decodeThreadDetail, decodeThreadDetailSnapshot } from "./projectionSnapshotDecoders.ts";
import { toPersistenceSqlOrDecodeError } from "./projectionSnapshotErrors.ts";
import {
  toProjectedActivity,
  toProjectedCheckpoint,
  toProjectedLatestTurn,
  toProjectedMessage,
  toProjectedProposedPlan,
  toProjectedSession,
  toProjectedThread,
  toProjectedThreadShellFromStoredSummary,
} from "./projectionSnapshotProjection.ts";
import { decodeProjectionThreadOption, MAX_THREAD_MESSAGES } from "./projectionSnapshotRows.ts";
import type { ProjectionQuerySet } from "./projectionQuerySet.ts";

export function makeThreadOperations(input: {
  readonly sql: SqlClient.SqlClient;
  readonly queries: ProjectionQuerySet;
}) {
  const { sql, queries } = input;
  const {
    getThreadRowById,
    getSyntheticSubagentParentThreadRow,
    listThreadMessageRowsByThread,
    listThreadProposedPlanRowsByThread,
    listThreadActivityRowsByThread,
    listCheckpointRowsByThread,
    getLatestTurnRowByThread,
    getThreadSessionRowByThread,
    listProjectionStateRows,
  } = queries;

  // Hydrate a full thread detail projection without opening its own transaction.
  const loadThreadDetail = (
    threadId: ThreadId,
    options: { readonly messageLimit: number | null; readonly tracePrefix: string } = {
      messageLimit: MAX_THREAD_MESSAGES,
      tracePrefix: "ProjectionSnapshotQuery.getThreadDetailById",
    },
  ) =>
    Effect.gen(function* () {
      const threadRow = yield* getThreadRowById({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            `${options.tracePrefix}:getThread:query`,
            `${options.tracePrefix}:getThread:decodeRow`,
          ),
        ),
        Effect.flatMap((option) =>
          decodeProjectionThreadOption(
            option,
            `${options.tracePrefix}:getThread:decodeModelSelection`,
          ),
        ),
      );
      if (Option.isNone(threadRow)) return Option.none<OrchestrationThread>();

      const [
        messageRows,
        proposedPlanRows,
        activityRows,
        checkpointRows,
        latestTurnRow,
        sessionRow,
      ] = yield* Effect.all([
        listThreadMessageRowsByThread({ threadId, maxMessages: options.messageLimit }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:listMessages:query`,
              `${options.tracePrefix}:listMessages:decodeRows`,
            ),
          ),
        ),
        listThreadProposedPlanRowsByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:listPlans:query`,
              `${options.tracePrefix}:listPlans:decodeRows`,
            ),
          ),
        ),
        listThreadActivityRowsByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:listActivities:query`,
              `${options.tracePrefix}:listActivities:decodeRows`,
            ),
          ),
        ),
        listCheckpointRowsByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:listCheckpoints:query`,
              `${options.tracePrefix}:listCheckpoints:decodeRows`,
            ),
          ),
        ),
        getLatestTurnRowByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:getLatestTurn:query`,
              `${options.tracePrefix}:getLatestTurn:decodeRow`,
            ),
          ),
        ),
        getThreadSessionRowByThread({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              `${options.tracePrefix}:getSession:query`,
              `${options.tracePrefix}:getSession:decodeRow`,
            ),
          ),
        ),
      ]);

      const thread = toProjectedThread({
        threadRow: threadRow.value,
        latestTurn: Option.match(latestTurnRow, {
          onNone: () => null,
          onSome: (row) => toProjectedLatestTurn(row),
        }),
        messages: messageRows.map((row) => toProjectedMessage(row)),
        proposedPlans: proposedPlanRows.map((row) => toProjectedProposedPlan(row)),
        activities: activityRows.map((row) => toProjectedActivity(row)),
        checkpoints: checkpointRows.map((row) => toProjectedCheckpoint(row)),
        session: Option.match(sessionRow, {
          onNone: () => null,
          onSome: (row) => toProjectedSession(row),
        }),
      });

      return yield* decodeThreadDetail(thread).pipe(
        Effect.map((decodedThread) => Option.some(decodedThread)),
        Effect.mapError(toPersistenceDecodeError(`${options.tracePrefix}:decodeThread`)),
      );
    });

  const getThreadShellById: ProjectionSnapshotQueryShape["getThreadShellById"] = (threadId) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const threadRow = yield* getThreadRowById({ threadId }).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getThreadShellById:getThread:query",
                "ProjectionSnapshotQuery.getThreadShellById:getThread:decodeRow",
              ),
            ),
            Effect.flatMap((option) =>
              decodeProjectionThreadOption(
                option,
                "ProjectionSnapshotQuery.getThreadShellById:getThread:decodeModelSelection",
              ),
            ),
          );
          if (Option.isNone(threadRow)) return Option.none<OrchestrationThreadShell>();
          const [latestTurnRow, sessionRow] = yield* Effect.all([
            getLatestTurnRowByThread({ threadId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getThreadShellById:getLatestTurn:query",
                  "ProjectionSnapshotQuery.getThreadShellById:getLatestTurn:decodeRow",
                ),
              ),
            ),
            getThreadSessionRowByThread({ threadId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getThreadShellById:getSession:query",
                  "ProjectionSnapshotQuery.getThreadShellById:getSession:decodeRow",
                ),
              ),
            ),
          ]);
          return Option.some(
            toProjectedThreadShellFromStoredSummary({
              threadRow: threadRow.value,
              latestTurn: Option.match(latestTurnRow, {
                onNone: () => null,
                onSome: (row) => toProjectedLatestTurn(row),
              }),
              session: Option.match(sessionRow, {
                onNone: () => null,
                onSome: (row) => toProjectedSession(row),
              }),
            }),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("ProjectionSnapshotQuery.getThreadShellById:query")(error),
        ),
      );

  const findSyntheticSubagentParentThread: ProjectionSnapshotQueryShape["findSyntheticSubagentParentThread"] =
    (threadId) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const parentRow = yield* getSyntheticSubagentParentThreadRow({ threadId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.findSyntheticSubagentParentThread:getThread:query",
                  "ProjectionSnapshotQuery.findSyntheticSubagentParentThread:getThread:decodeRow",
                ),
              ),
              Effect.flatMap((option) =>
                decodeProjectionThreadOption(
                  option,
                  "ProjectionSnapshotQuery.findSyntheticSubagentParentThread:getThread:decodeModelSelection",
                ),
              ),
            );
            if (Option.isNone(parentRow)) return Option.none<OrchestrationThread>();
            return yield* loadThreadDetail(parentRow.value.threadId);
          }),
        )
        .pipe(
          Effect.mapError((error) =>
            isPersistenceError(error)
              ? error
              : toPersistenceSqlError(
                  "ProjectionSnapshotQuery.findSyntheticSubagentParentThread:query",
                )(error),
          ),
        );

  const getThreadDetailById: ProjectionSnapshotQueryShape["getThreadDetailById"] = (threadId) =>
    sql
      .withTransaction(loadThreadDetail(threadId))
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("ProjectionSnapshotQuery.getThreadDetailById:query")(error),
        ),
      );

  const getThreadDetailForExportById: ProjectionSnapshotQueryShape["getThreadDetailForExportById"] =
    (threadId) =>
      sql
        .withTransaction(
          loadThreadDetail(threadId, {
            messageLimit: null,
            tracePrefix: "ProjectionSnapshotQuery.getThreadDetailForExportById",
          }),
        )
        .pipe(
          Effect.mapError((error) =>
            isPersistenceError(error)
              ? error
              : toPersistenceSqlError("ProjectionSnapshotQuery.getThreadDetailForExportById:query")(
                  error,
                ),
          ),
        );

  // Capture the projection cursor and thread detail in one transaction so the
  // snapshot fence cannot advance past the detail payload the client receives.
  const getThreadDetailSnapshotById: ProjectionSnapshotQueryShape["getThreadDetailSnapshotById"] = (
    threadId,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [threadDetail, stateRows] = yield* Effect.all([
            loadThreadDetail(threadId),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getThreadDetailSnapshotById:listProjectionState:query",
                  "ProjectionSnapshotQuery.getThreadDetailSnapshotById:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);
          if (Option.isNone(threadDetail)) {
            return Option.none<OrchestrationThreadDetailSnapshot>();
          }
          return yield* decodeThreadDetailSnapshot({
            snapshotSequence: computeSnapshotSequence(stateRows),
            thread: threadDetail.value,
          }).pipe(
            Effect.map((snapshot) => Option.some(snapshot)),
            Effect.mapError(
              toPersistenceDecodeError(
                "ProjectionSnapshotQuery.getThreadDetailSnapshotById:decodeSnapshot",
              ),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("ProjectionSnapshotQuery.getThreadDetailSnapshotById:query")(
                error,
              ),
        ),
      );

  return {
    getThreadShellById,
    findSyntheticSubagentParentThread,
    getThreadDetailById,
    getThreadDetailForExportById,
    getThreadDetailSnapshotById,
  };
}
