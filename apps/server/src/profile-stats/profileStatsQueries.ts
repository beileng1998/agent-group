import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type {
  ArchivedSkillUsageRow,
  CountRow,
  MostWorkedProjectRow,
  PromptActivityRow,
  SkillUsageMessageRow,
  TokenDayRow,
  TurnInsightRow,
} from "./profileStatsRows";

// Maps every turn to the provider/model selected when it was started. Pass a
// scope to restrict the CTE to one thread for delete-time archive snapshots.
export function turnModelSelectionCte(
  sql: SqlClient.SqlClient,
  scope?: { readonly threadId: string },
) {
  const turnThreadMatch = scope
    ? sql`${scope.threadId}`
    : sql.literal("json_extract(e.payload_json, '$.threadId')");
  const eventThreadScope = scope
    ? sql`AND COALESCE(json_extract(e.payload_json, '$.threadId'), e.stream_id) = ${scope.threadId}`
    : sql.literal("");
  return sql`
    SELECT
      pt.thread_id AS thread_id,
      pt.turn_id AS turn_id,
      MAX(json_extract(e.payload_json, '$.modelSelection.provider')) AS provider,
      MAX(json_extract(e.payload_json, '$.modelSelection.model')) AS model
    FROM orchestration_events e
    JOIN projection_turns pt
      ON pt.thread_id = ${turnThreadMatch}
     AND pt.pending_message_id = json_extract(e.payload_json, '$.messageId')
    WHERE e.event_type = 'thread.turn-start-requested'
      ${eventThreadScope}
      AND pt.turn_id IS NOT NULL
      AND json_type(e.payload_json, '$.modelSelection') = 'object'
    GROUP BY pt.thread_id, pt.turn_id
  `;
}

function profileStatsErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingLegacyColumnError(error: unknown): boolean {
  return /\bno such column\b/iu.test(profileStatsErrorMessage(error));
}

export function makeProfileStatsQueries(sql: SqlClient.SqlClient) {
  const legacyCompatibleQuery = <T>(
    operation: string,
    query: Effect.Effect<ReadonlyArray<T>, unknown>,
  ) =>
    query.pipe(
      Effect.catchIf(isMissingLegacyColumnError, (error) =>
        Effect.logWarning("profile stats query skipped due to missing legacy column", {
          error: profileStatsErrorMessage(error),
          operation,
        }).pipe(Effect.as([] as ReadonlyArray<T>)),
      ),
    );

  const queryPromptActivity = (tz: string) =>
    legacyCompatibleQuery(
      "profileStats.promptActivity",
      sql<PromptActivityRow>`
        WITH prompt_events AS (
          -- The thread join (no deleted_at filter) keeps retention-hidden rows
          -- counting while excluding orphan message rows of purged threads,
          -- which are already counted from the archive tables.
          SELECT m.created_at AS created_at
          FROM projection_thread_messages m
          JOIN projection_threads t ON t.thread_id = m.thread_id
          WHERE m.role = 'user'
            AND m.source = 'native'
          UNION ALL
          SELECT d.created_at AS created_at
          FROM profile_stats_deleted_prompts d
        )
        SELECT
          STRFTIME('%Y-%m-%d', DATETIME(created_at, ${tz})) AS day,
          CAST(STRFTIME('%H', DATETIME(created_at, ${tz})) AS INTEGER) AS hour,
          COUNT(*) AS count
        FROM prompt_events
        GROUP BY day, hour
        ORDER BY day ASC, hour ASC
      `,
    );

  const queryTokenActivity = (tz: string) =>
    legacyCompatibleQuery(
      "profileStats.tokenActivity",
      sql<TokenDayRow>`
        WITH turn_model AS (
          ${turnModelSelectionCte(sql)}
        ),
        ev AS (
          SELECT
            a.thread_id AS thread_id,
            STRFTIME('%Y-%m-%d', DATETIME(a.created_at, ${tz})) AS day,
            COALESCE(
              tm.provider,
              CASE
                WHEN th.model_selection_json IS NOT NULL AND json_valid(th.model_selection_json)
                THEN json_extract(th.model_selection_json, '$.provider')
              END,
              'unknown'
            ) AS provider,
            COALESCE(
              tm.model,
              CASE
                WHEN th.model_selection_json IS NOT NULL AND json_valid(th.model_selection_json)
                THEN json_extract(th.model_selection_json, '$.model')
              END,
              'unknown'
            ) AS model,
            CAST(json_extract(a.payload_json, '$.totalProcessedTokens') AS INTEGER) AS tp,
            CAST(json_extract(a.payload_json, '$.usedTokens') AS INTEGER) AS ut,
            a.sequence AS sequence,
            a.created_at AS created_at,
            a.activity_id AS activity_id
          FROM projection_thread_activities a
          JOIN projection_threads th ON th.thread_id = a.thread_id
          LEFT JOIN turn_model tm
            ON tm.thread_id = a.thread_id
           AND tm.turn_id = a.turn_id
          WHERE a.kind = 'context-window.updated'
            AND COALESCE(
              json_extract(a.payload_json, '$.totalProcessedTokens'),
              json_extract(a.payload_json, '$.usedTokens')
            ) IS NOT NULL
        ),
        provider_model_scale AS (
          SELECT thread_id, provider, model, MAX(tp IS NOT NULL) AS has_cumulative
          FROM ev
          GROUP BY thread_id, provider, model
        ),
        cumulative_kept AS (
          SELECT
            day,
            provider,
            model,
            thread_id,
            tp AS tot,
            sequence,
            created_at,
            activity_id
          FROM ev
          WHERE tp IS NOT NULL
        ),
        cumulative_delta AS (
          SELECT
            day,
            provider,
            model,
            CASE
              WHEN previous_tot IS NULL OR tot < previous_tot THEN tot
              ELSE MAX(0, tot - previous_tot)
            END AS d
          FROM (
            SELECT
              day,
              provider,
              model,
              tot,
              LAG(tot) OVER (
                PARTITION BY thread_id
                ORDER BY
                  CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
                  sequence ASC,
                  created_at ASC,
                  activity_id ASC
              ) AS previous_tot
            FROM cumulative_kept
          )
        ),
        used_only_kept AS (
          SELECT
            ev.day AS day,
            ev.provider AS provider,
            ev.model AS model,
            ev.thread_id AS thread_id,
            ev.ut AS tot,
            ev.sequence AS sequence,
            ev.created_at AS created_at,
            ev.activity_id AS activity_id
          FROM ev
          JOIN provider_model_scale pms
            ON pms.thread_id = ev.thread_id
           AND pms.provider = ev.provider
           AND pms.model = ev.model
          WHERE ev.tp IS NULL
            AND ev.ut IS NOT NULL
            AND NOT pms.has_cumulative
        ),
        used_only_delta AS (
          SELECT
            day,
            provider,
            model,
            CASE
              WHEN previous_tot IS NULL THEN tot
              WHEN tot < previous_tot
                AND (provider != previous_provider OR model != previous_model)
              THEN tot
              ELSE MAX(0, tot - previous_tot)
            END AS d
          FROM (
            SELECT
              day,
              provider,
              model,
              tot,
              LAG(tot) OVER (
                PARTITION BY thread_id
                ORDER BY
                  CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
                  sequence ASC,
                  created_at ASC,
                  activity_id ASC
              ) AS previous_tot,
              LAG(provider) OVER (
                PARTITION BY thread_id
                ORDER BY
                  CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
                  sequence ASC,
                  created_at ASC,
                  activity_id ASC
              ) AS previous_provider,
              LAG(model) OVER (
                PARTITION BY thread_id
                ORDER BY
                  CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
                  sequence ASC,
                  created_at ASC,
                  activity_id ASC
              ) AS previous_model
            FROM used_only_kept
          )
        ),
        all_tokens AS (
          SELECT day, provider, model, d FROM cumulative_delta
          UNION ALL
          SELECT day, provider, model, d FROM used_only_delta
          UNION ALL
          SELECT
            STRFTIME('%Y-%m-%d', DATETIME(a.created_at, ${tz})) AS day,
            COALESCE(a.provider, 'unknown') AS provider,
            COALESCE(a.model, 'unknown') AS model,
            a.tokens AS d
          FROM profile_stats_deleted_tokens a
        )
        SELECT day, provider, model, SUM(d) AS tokens
        FROM all_tokens
        GROUP BY day, provider, model
      `,
    );

  const queryTotalThreads = () =>
    legacyCompatibleQuery(
      "profileStats.totalThreads",
      sql<CountRow>`
        SELECT
          (SELECT COUNT(*) FROM projection_threads)
          + (SELECT COUNT(*) FROM profile_stats_deleted_threads) AS count
      `,
    );

  const queryTurnInsights = () =>
    legacyCompatibleQuery(
      "profileStats.turnInsights",
      sql<TurnInsightRow>`
        WITH per_turn AS (
          SELECT
            CASE
              WHEN json_type(e.payload_json, '$.modelSelection') = 'object'
              THEN json_extract(e.payload_json, '$.modelSelection.provider')
              ELSE CASE
                WHEN t.model_selection_json IS NOT NULL AND json_valid(t.model_selection_json)
                THEN json_extract(t.model_selection_json, '$.provider')
              END
            END AS provider,
            CASE
              WHEN json_type(e.payload_json, '$.modelSelection') = 'object'
              THEN json_extract(e.payload_json, '$.modelSelection.model')
              ELSE CASE
                WHEN t.model_selection_json IS NOT NULL AND json_valid(t.model_selection_json)
                THEN json_extract(t.model_selection_json, '$.model')
              END
            END AS model,
            CASE
              WHEN json_type(e.payload_json, '$.modelSelection') = 'object'
              THEN COALESCE(
                json_extract(e.payload_json, '$.modelSelection.options.reasoningEffort'),
                json_extract(e.payload_json, '$.modelSelection.options.effort')
              )
              ELSE CASE
                WHEN t.model_selection_json IS NOT NULL AND json_valid(t.model_selection_json)
                THEN COALESCE(
                  json_extract(t.model_selection_json, '$.options.reasoningEffort'),
                  json_extract(t.model_selection_json, '$.options.effort')
                )
              END
            END AS reasoning
          FROM orchestration_events e
          JOIN projection_threads t
            ON t.thread_id = COALESCE(json_extract(e.payload_json, '$.threadId'), e.stream_id)
          WHERE e.event_type = 'thread.turn-start-requested'
        ),
        turn_counts AS (
          SELECT provider, model, reasoning, COUNT(*) AS count
          FROM per_turn
          GROUP BY provider, model, reasoning
          UNION ALL
          SELECT provider, model, reasoning, turn_count AS count
          FROM profile_stats_deleted_turns
        )
        SELECT provider, model, reasoning, SUM(count) AS count
        FROM turn_counts
        GROUP BY provider, model, reasoning
        ORDER BY count DESC, provider ASC, model ASC, reasoning ASC
      `,
    );

  const querySkillUsageMessages = () =>
    sql<SkillUsageMessageRow>`
      SELECT
        m.message_id AS messageId,
        CASE
          WHEN m.text GLOB '*$[A-Za-z0-9]*'
            OR m.text GLOB '*/[A-Za-z0-9]*'
          THEN m.text
          ELSE NULL
        END AS text,
        m.skills_json AS skillsJson,
        m.mentions_json AS mentionsJson
      FROM projection_thread_messages m
      JOIN projection_threads t ON t.thread_id = m.thread_id
      WHERE m.role = 'user'
        AND m.source = 'native'
        AND (
          (m.skills_json IS NOT NULL AND TRIM(m.skills_json) NOT IN ('', '[]'))
          OR (m.mentions_json IS NOT NULL AND TRIM(m.mentions_json) NOT IN ('', '[]'))
          OR m.text GLOB '*$[A-Za-z0-9]*'
          OR m.text GLOB '*/[A-Za-z0-9]*'
        )
      ORDER BY m.created_at ASC, m.message_id ASC
    `.pipe(
      Effect.catchIf(isMissingLegacyColumnError, (error) =>
        Effect.logWarning("profile stats skill usage fell back to text-only legacy scan", {
          error: profileStatsErrorMessage(error),
          operation: "profileStats.skillUsage",
        }).pipe(
          Effect.flatMap(
            () => sql<SkillUsageMessageRow>`
              SELECT
                m.message_id AS messageId,
                m.text AS text,
                NULL AS skillsJson,
                NULL AS mentionsJson
              FROM projection_thread_messages m
              JOIN projection_threads t ON t.thread_id = m.thread_id
              WHERE m.role = 'user'
                AND (
                  m.text GLOB '*$[A-Za-z0-9]*'
                  OR m.text GLOB '*/[A-Za-z0-9]*'
                )
              ORDER BY m.created_at ASC, m.message_id ASC
            `,
          ),
        ),
      ),
    );

  const queryArchivedSkillUsage = () =>
    legacyCompatibleQuery(
      "profileStats.archivedSkillUsage",
      sql<ArchivedSkillUsageRow>`
        SELECT name, kind, run_count AS runCount
        FROM profile_stats_deleted_skills
      `,
    );

  const queryMostWorkedProject = (tz: string) =>
    legacyCompatibleQuery(
      "profileStats.mostWorkedProject",
      sql<MostWorkedProjectRow>`
        WITH project_prompts AS (
          SELECT
            t.project_id AS project_id,
            m.thread_id AS thread_id,
            m.created_at AS created_at
          FROM projection_thread_messages m
          JOIN projection_threads t ON t.thread_id = m.thread_id
          WHERE m.role = 'user'
            AND m.source = 'native'
          UNION ALL
          SELECT
            d.project_id AS project_id,
            d.thread_id AS thread_id,
            d.created_at AS created_at
          FROM profile_stats_deleted_prompts d
        )
        SELECT
          p.project_id AS projectId,
          p.title AS title,
          p.workspace_root AS workspaceRoot,
          COUNT(*) AS promptCount,
          COUNT(DISTINCT e.thread_id) AS threadCount,
          COUNT(DISTINCT STRFTIME('%Y-%m-%d', DATETIME(e.created_at, ${tz}))) AS activeDays,
          MAX(e.created_at) AS lastWorkedAt
        FROM project_prompts e
        JOIN projection_projects p ON p.project_id = e.project_id
        GROUP BY p.project_id, p.title, p.workspace_root
        ORDER BY
          promptCount DESC,
          activeDays DESC,
          lastWorkedAt DESC,
          p.title ASC
        LIMIT 1
      `,
    );

  return {
    queryPromptActivity,
    queryTokenActivity,
    queryTotalThreads,
    queryTurnInsights,
    querySkillUsageMessages,
    queryArchivedSkillUsage,
    queryMostWorkedProject,
  };
}
