// FILE: profileStatsArchive.ts
// Purpose: Snapshot a thread's profile-stat aggregates into the durable
// profile_stats_deleted_* tables, then hard-delete every row the thread owns
// (projections, events, checkpoints, session runtime). This is what lets a
// delete actually free disk space without shrinking the Profile page numbers.
// Layer: server maintenance service (SqlClient).

import { Effect, Layer, ServiceMap } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CheckpointStore } from "./checkpointing/Services/CheckpointStore";
import {
  aggregateThreadTokenRows,
  aggregateThreadTurnSnapshotRows,
  hasProfileStatsContribution,
  parseModelSelectionJson,
  type SkillMessageRow,
  type TokenActivityRow,
  type TurnEventRow,
} from "./profile-stats-archive/profileStatsArchiveAggregation";
import { makeProfileStatsCheckpointCleanup } from "./profile-stats-archive/profileStatsCheckpointCleanup";
import { aggregateProfileSkillUsageRows, turnModelSelectionCte } from "./profileStats";
import { THREAD_RETENTION_COMMAND_ID_PREFIX } from "./threadRetention";

export {
  aggregateThreadTokenRows,
  aggregateThreadTurnSnapshotRows,
  type ThreadTokenSnapshotRow,
  type ThreadTurnSnapshotRow,
} from "./profile-stats-archive/profileStatsArchiveAggregation";

interface PurgeThreadRow {
  readonly projectId: string | null;
  readonly modelSelectionJson: string | null;
  readonly deletedAt: string | null;
  readonly envMode: string | null;
  readonly worktreePath: string | null;
  readonly projectKind: string | null;
  readonly workspaceRoot: string | null;
}

// ── Service ────────────────────────────────────────────────────────────

export interface ProfileStatsArchiveShape {
  // Snapshots the thread's stat aggregates and hard-deletes all of its rows in
  // one transaction. Returns false when the thread row is already gone.
  readonly purgeThreadWithStatsSnapshot: (input: {
    readonly threadId: string;
  }) => Effect.Effect<boolean, unknown>;
  // Purges every soft-deleted thread that was NOT hidden by the retention
  // sweep. Catches per-thread failures so one bad thread cannot stall the
  // sweep; returns how many threads were purged.
  readonly purgeSoftDeletedManualThreads: (input?: {
    readonly beforePurge?: (threadId: string) => Effect.Effect<boolean, unknown>;
  }) => Effect.Effect<number, unknown>;
}

export class ProfileStatsArchive extends ServiceMap.Service<
  ProfileStatsArchive,
  ProfileStatsArchiveShape
>()("agent-group/profileStats/ProfileStatsArchive") {}

const makeProfileStatsArchive = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const checkpointStore = yield* CheckpointStore;
  const threadDeletedAutomationRunResultJson = JSON.stringify({
    outcome: "needs-attention",
    summary: "Automation run was interrupted because its thread was deleted.",
    severity: "warning",
    unread: true,
    archivedAt: null,
  });
  const { loadThreadCheckpointCleanup, deleteCheckpointRefsAfterCommittedPurge } =
    makeProfileStatsCheckpointCleanup({ sql, checkpointStore });

  const snapshotAndPurgeThread = (threadId: string) =>
    Effect.gen(function* () {
      const threadRows = yield* sql<PurgeThreadRow>`
        SELECT
          t.project_id AS projectId,
          t.model_selection_json AS modelSelectionJson,
          t.deleted_at AS deletedAt,
          t.env_mode AS envMode,
          t.worktree_path AS worktreePath,
          p.kind AS projectKind,
          p.workspace_root AS workspaceRoot
        FROM projection_threads t
        LEFT JOIN projection_projects p ON p.project_id = t.project_id
        WHERE t.thread_id = ${threadId}
      `;
      const thread = threadRows[0];
      if (!thread) {
        return false;
      }
      const deletedAt = thread.deletedAt ?? new Date().toISOString();
      const projectId = thread.projectId ?? null;

      const turnEventRows = yield* sql<TurnEventRow>`
        SELECT payload_json AS payloadJson
        FROM orchestration_events
        WHERE event_type = 'thread.turn-start-requested'
          AND COALESCE(json_extract(payload_json, '$.threadId'), stream_id) = ${threadId}
      `;
      // Same counters and per-turn attribution as the live
      // profileStats.queryTokenActivity: both token counters come back raw so
      // aggregateThreadTokenRows can split cumulative and used-only fallback
      // series, and the turn join pins each delta to the selected model.
      const tokenActivityRows = yield* sql<TokenActivityRow>`
        WITH turn_model AS (
          ${turnModelSelectionCte(sql, { threadId })}
        )
        SELECT
          CAST(json_extract(a.payload_json, '$.totalProcessedTokens') AS INTEGER)
            AS totalProcessedTokens,
          CAST(json_extract(a.payload_json, '$.usedTokens') AS INTEGER) AS usedTokens,
          tm.provider AS provider,
          tm.model AS model,
          a.created_at AS createdAt
        FROM projection_thread_activities a
        LEFT JOIN turn_model tm
          ON tm.thread_id = a.thread_id
         AND tm.turn_id = a.turn_id
        WHERE a.thread_id = ${threadId}
          AND a.kind = 'context-window.updated'
          AND COALESCE(
            json_extract(a.payload_json, '$.totalProcessedTokens'),
            json_extract(a.payload_json, '$.usedTokens')
          ) IS NOT NULL
        ORDER BY
          CASE WHEN a.sequence IS NULL THEN 0 ELSE 1 END ASC,
          a.sequence ASC,
          a.created_at ASC,
          a.activity_id ASC
      `;
      const skillMessageRows = yield* sql<SkillMessageRow>`
        SELECT
          message_id AS messageId,
          text,
          skills_json AS skillsJson,
          mentions_json AS mentionsJson
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
          AND role = 'user'
          AND source = 'native'
        ORDER BY created_at ASC, message_id ASC
      `;

      const turnRows = aggregateThreadTurnSnapshotRows(turnEventRows, thread.modelSelectionJson);
      const threadSelection = parseModelSelectionJson(thread.modelSelectionJson);
      const tokenRows = aggregateThreadTokenRows(tokenActivityRows, {
        provider: threadSelection?.provider ?? null,
        model: threadSelection?.model ?? null,
      });
      const skillRows = aggregateProfileSkillUsageRows(skillMessageRows);
      const hasStatsContribution = hasProfileStatsContribution({
        promptRows: skillMessageRows,
        turnRows,
        tokenRows,
        skillRows,
      });

      // Snapshot writes are idempotent per thread so an interrupted purge can
      // safely re-run: wipe any partial snapshot before inserting the new one.
      yield* sql`DELETE FROM profile_stats_deleted_threads WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM profile_stats_deleted_prompts WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM profile_stats_deleted_turns WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM profile_stats_deleted_skills WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM profile_stats_deleted_tokens WHERE thread_id = ${threadId}`;

      if (hasStatsContribution) {
        yield* sql`
          INSERT INTO profile_stats_deleted_threads (thread_id, project_id, deleted_at)
          VALUES (${threadId}, ${projectId}, ${deletedAt})
        `;
        yield* sql`
          INSERT INTO profile_stats_deleted_prompts (thread_id, project_id, created_at)
          SELECT thread_id, ${projectId}, created_at
          FROM projection_thread_messages
          WHERE thread_id = ${threadId}
            AND role = 'user'
            AND source = 'native'
        `;
        yield* Effect.forEach(
          turnRows,
          (row) => sql`
            INSERT INTO profile_stats_deleted_turns (thread_id, provider, model, reasoning, turn_count)
            VALUES (${threadId}, ${row.provider}, ${row.model}, ${row.reasoning}, ${row.turnCount})
          `,
          { concurrency: 1, discard: true },
        );
        yield* Effect.forEach(
          skillRows,
          (row) => sql`
            INSERT INTO profile_stats_deleted_skills (thread_id, name, kind, run_count)
            VALUES (${threadId}, ${row.name}, ${row.kind}, ${row.runCount})
          `,
          { concurrency: 1, discard: true },
        );
        yield* Effect.forEach(
          tokenRows,
          (row) => sql`
            INSERT INTO profile_stats_deleted_tokens (thread_id, created_at, provider, model, tokens)
            VALUES (${threadId}, ${row.createdAt}, ${row.provider}, ${row.model}, ${row.tokens})
          `,
          { concurrency: 1, discard: true },
        );
      }

      // Hard delete: every table that stores rows for this thread. The delete
      // receipts stay as tiny idempotency tombstones for command retries after
      // the bulky event/projection rows are gone.
      // The event delete mirrors the snapshot scope above (stream id OR
      // payload threadId, thread aggregate only) so no snapshotted event can
      // survive the purge.
      yield* sql`
        DELETE FROM orchestration_events
        WHERE aggregate_kind = 'thread'
          AND (
            stream_id = ${threadId}
            OR json_extract(payload_json, '$.threadId') = ${threadId}
          )
      `;
      yield* sql`DELETE FROM checkpoint_diff_blobs WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM provider_session_runtime WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM projection_pending_approvals WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM projection_thread_activities WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM projection_thread_messages WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM projection_thread_highlights WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM projection_thread_proposed_plans WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM projection_thread_sessions WHERE thread_id = ${threadId}`;
      yield* sql`DELETE FROM projection_turns WHERE thread_id = ${threadId}`;
      yield* sql`
        UPDATE automation_runs
        SET status = 'interrupted',
            error = 'Automation run was interrupted because its thread was deleted.',
            result_json = ${threadDeletedAutomationRunResultJson},
            finished_at = COALESCE(finished_at, ${deletedAt}),
            updated_at = ${deletedAt},
            lease_expires_at = NULL,
            claimed_by = NULL
        WHERE thread_id = ${threadId}
          AND status NOT IN ('succeeded', 'failed', 'cancelled', 'interrupted', 'skipped')
      `;
      yield* sql`DELETE FROM projection_threads WHERE thread_id = ${threadId}`;

      return true;
    });

  const purgeThreadWithStatsSnapshot: ProfileStatsArchiveShape["purgeThreadWithStatsSnapshot"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const checkpointCleanup = yield* loadThreadCheckpointCleanup(input.threadId);
      if (checkpointCleanup === null) {
        return false;
      }
      const purged = yield* sql.withTransaction(snapshotAndPurgeThread(input.threadId));
      if (purged) {
        yield* deleteCheckpointRefsAfterCommittedPurge({
          threadId: input.threadId,
          cwd: checkpointCleanup.cwd,
          checkpointRefs: checkpointCleanup.checkpointRefs,
        });
      }
      return purged;
    });

  const purgeSoftDeletedManualThreads: ProfileStatsArchiveShape["purgeSoftDeletedManualThreads"] = (
    input,
  ) =>
    Effect.gen(function* () {
      // Classify by the LATEST thread.deleted event: only threads whose most
      // recent delete came from retention stay hidden-but-kept. Soft-deleted
      // threads without any recorded delete event (legacy imports) count as
      // manual deletes and get purged too.
      const candidates = yield* sql<{ readonly threadId: string }>`
          SELECT t.thread_id AS threadId
          FROM projection_threads t
          WHERE t.deleted_at IS NOT NULL
            AND COALESCE(
              (
                SELECT td.command_id
                FROM orchestration_events td
                WHERE td.event_type = 'thread.deleted'
                  AND td.stream_id = t.thread_id
                ORDER BY td.sequence DESC
                LIMIT 1
              ),
              ''
            ) NOT LIKE ${`${THREAD_RETENTION_COMMAND_ID_PREFIX}%`}
        `;

      let purgedCount = 0;
      yield* Effect.forEach(
        candidates,
        (candidate) =>
          Effect.gen(function* () {
            const shouldPurge = input?.beforePurge
              ? yield* input.beforePurge(candidate.threadId)
              : true;
            if (!shouldPurge) {
              return;
            }
            const purged = yield* purgeThreadWithStatsSnapshot({
              threadId: candidate.threadId,
            });
            if (purged) {
              purgedCount += 1;
            }
          }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("profile stats archive failed to purge soft-deleted thread", {
                threadId: candidate.threadId,
                error: error instanceof Error ? error.message : String(error),
              }),
            ),
          ),
        { concurrency: 1, discard: true },
      );
      return purgedCount;
    });

  return {
    purgeThreadWithStatsSnapshot,
    purgeSoftDeletedManualThreads,
  } satisfies ProfileStatsArchiveShape;
});

export const ProfileStatsArchiveLive = Layer.effect(ProfileStatsArchive, makeProfileStatsArchive);
