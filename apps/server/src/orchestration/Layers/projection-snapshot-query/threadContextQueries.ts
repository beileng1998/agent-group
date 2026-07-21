import { STUDIO_OUTPUTS_ACTIVITY_KIND } from "@agent-group/contracts";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  FullThreadDiffContextLookupInput,
  MAX_THREAD_FILE_CHANGE_ACTIVITIES,
  MAX_TURN_GENERATED_IMAGE_ACTIVITY_RECORDS,
  ProjectionCheckpointDbRowSchema,
  ProjectionFileChangeActivityPayloadDbRowSchema,
  ProjectionFullThreadDiffContextRowSchema,
  ProjectionGeneratedImageActivityDbRowSchema,
  ProjectionLatestTurnDbRowSchema,
  ProjectionThreadCheckpointContextThreadRowSchema,
  ProjectionThreadSessionDbRowSchema,
  ThreadIdLookupInput,
  ThreadTurnLookupInput,
} from "./projectionSnapshotRows.ts";

export function makeThreadContextQueries(sql: SqlClient.SqlClient) {
  const getThreadSessionRowByThread = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        WHERE thread_id = ${threadId}
        LIMIT 1
      `,
  });

  const getLatestTurnRowByThread = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NOT NULL
        ORDER BY requested_at DESC, turn_id DESC
        LIMIT 1
      `,
  });

  const getThreadCheckpointContextThreadRow = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadCheckpointContextThreadRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          projects.kind AS "projectKind",
          projects.workspace_root AS "workspaceRoot",
          threads.env_mode AS "envMode",
          threads.worktree_path AS "worktreePath"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL
        LIMIT 1
      `,
  });

  const listCheckpointRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          COALESCE(completed_at, started_at, requested_at) AS "completedAt"
        FROM projection_turns
        -- Keep incomplete provider-diff placeholders out of the public
        -- checkpoint summary contract, which requires completedAt.
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
          AND completed_at IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `,
  });

  // File-change tool payloads and captured per-turn Studio outputs remain available in
  // non-Git workspaces, where checkpoint capture intentionally does not run. Studio output
  // attribution requests this narrow slice.
  const listFileChangeActivityPayloadsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionFileChangeActivityPayloadDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT payload_json AS "payload"
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
          AND (
            (kind = 'tool.completed' AND json_extract(payload_json, '$.itemType') = 'file_change')
            OR kind = ${STUDIO_OUTPUTS_ACTIVITY_KIND}
          )
        ORDER BY created_at DESC, activity_id DESC
        LIMIT ${MAX_THREAD_FILE_CHANGE_ACTIVITIES}
      `,
  });

  // Generated-image references are recovered at turn settlement. Keep this query
  // independent of the 500-row thread-detail activity window: a long-running turn
  // can emit far more tool activities before its terminal event arrives.
  const listGeneratedImageActivityRowsByTurn = SqlSchema.findAll({
    Request: ThreadTurnLookupInput,
    Result: ProjectionGeneratedImageActivityDbRowSchema,
    execute: ({ threadId, turnId }) =>
      sql`
        SELECT kind, payload_json AS "payload"
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
          AND (
            (kind = 'tool.completed' AND json_extract(payload_json, '$.itemType') = 'image_generation')
            OR (
              kind = ${STUDIO_OUTPUTS_ACTIVITY_KIND}
              AND json_type(payload_json, '$.data.generatedImage') = 'object'
            )
          )
        -- Provider replay can project the same completion more than once. Collapse
        -- exact payload duplicates before applying the two-records-per-image cap.
        GROUP BY kind, payload_json
        ORDER BY MIN(created_at) ASC, MIN(activity_id) ASC
        LIMIT ${MAX_TURN_GENERATED_IMAGE_ACTIVITY_RECORDS}
      `,
  });

  const getFullThreadDiffContextRow = SqlSchema.findOneOption({
    Request: FullThreadDiffContextLookupInput,
    Result: ProjectionFullThreadDiffContextRowSchema,
    execute: ({ threadId, checkpointTurnCount }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          projects.kind AS "projectKind",
          projects.workspace_root AS "workspaceRoot",
          threads.env_mode AS "envMode",
          threads.worktree_path AS "worktreePath",
          (
            SELECT MAX(turns.checkpoint_turn_count)
            FROM projection_turns AS turns
            WHERE turns.thread_id = threads.thread_id
              AND turns.checkpoint_turn_count IS NOT NULL
              AND turns.completed_at IS NOT NULL
          ) AS "latestCheckpointTurnCount",
          (
            SELECT turns.checkpoint_ref
            FROM projection_turns AS turns
            WHERE turns.thread_id = threads.thread_id
              AND turns.checkpoint_turn_count IS NOT NULL
              AND turns.completed_at IS NOT NULL
            ORDER BY turns.checkpoint_turn_count ASC
            LIMIT 1
          ) AS "baselineCheckpointRef",
          (
            SELECT turns.checkpoint_ref
            FROM projection_turns AS turns
            WHERE turns.thread_id = threads.thread_id
              AND turns.checkpoint_turn_count = ${checkpointTurnCount}
              AND turns.completed_at IS NOT NULL
            LIMIT 1
          ) AS "toCheckpointRef"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL
        LIMIT 1
      `,
  });

  return {
    getThreadSessionRowByThread,
    getLatestTurnRowByThread,
    getThreadCheckpointContextThreadRow,
    listCheckpointRowsByThread,
    listFileChangeActivityPayloadsByThread,
    listGeneratedImageActivityRowsByTurn,
    getFullThreadDiffContextRow,
  };
}

export type ThreadContextQueries = ReturnType<typeof makeThreadContextQueries>;
