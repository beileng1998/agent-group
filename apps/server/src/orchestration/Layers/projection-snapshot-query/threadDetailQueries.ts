import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  MAX_THREAD_ACTIVITIES,
  ProjectionThreadActivityDbRowSchema,
  ProjectionThreadMessageDbRowSchema,
  ProjectionThreadProposedPlanDbRowSchema,
  ThreadIdLookupInput,
  ThreadMessagesByThreadLookupInput,
} from "./projectionSnapshotRows.ts";

export function makeThreadDetailQueries(sql: SqlClient.SqlClient) {
  const listThreadMessageRowsByThread = SqlSchema.findAll({
    Request: ThreadMessagesByThreadLookupInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId, maxMessages }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          skills_json AS "skills",
          mentions_json AS "mentions",
          dispatch_mode AS "dispatchMode",
          dispatch_origin AS "dispatchOrigin",
          is_streaming AS "isStreaming",
          source,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY created_at DESC, message_id DESC
            ) AS message_rank
          FROM projection_thread_messages
          WHERE thread_id = ${threadId}
        )
        WHERE thread_id = ${threadId}
          AND (
            ${maxMessages} IS NULL
            OR message_rank <= ${maxMessages}
            OR message_id IN (
              SELECT message_id
              FROM projection_thread_highlights
              WHERE thread_id = ${threadId}
            )
          )
        ORDER BY created_at ASC, message_id ASC
      `,
  });

  const listThreadProposedPlanRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          plan_id AS "planId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          plan_markdown AS "planMarkdown",
          implemented_at AS "implementedAt",
          implementation_thread_id AS "implementationThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, plan_id ASC
      `,
  });

  const listThreadActivityRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY
                CASE WHEN sequence IS NULL THEN 0 ELSE 1 END DESC,
                sequence DESC,
                created_at DESC,
                activity_id DESC
            ) AS activity_rank
          FROM projection_thread_activities
          WHERE thread_id = ${threadId}
        ) AS ranked
        WHERE thread_id = ${threadId}
          AND (
            activity_rank <= ${MAX_THREAD_ACTIVITIES}
            OR (
              kind IN ('approval.requested', 'user-input.requested')
              AND json_extract(payload_json, '$.requestId') IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM projection_thread_activities AS later
                WHERE later.thread_id = ranked.thread_id
                  AND json_extract(later.payload_json, '$.requestId') =
                    json_extract(ranked.payload_json, '$.requestId')
                  AND (
                    (ranked.kind = 'approval.requested' AND later.kind = 'approval.resolved')
                    OR (
                      ranked.kind = 'approval.requested'
                      AND later.kind = 'provider.approval.respond.failed'
                      AND (
                        lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                          '%stale pending approval request%'
                        OR lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                          '%unknown pending approval request%'
                        OR lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                          '%unknown pending permission request%'
                      )
                    )
                    OR (ranked.kind = 'user-input.requested' AND later.kind = 'user-input.resolved')
                    OR (
                      ranked.kind = 'user-input.requested'
                      AND later.kind = 'provider.user-input.respond.failed'
                      AND (
                        lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                          '%stale pending user-input request%'
                        OR lower(COALESCE(json_extract(later.payload_json, '$.detail'), '')) LIKE
                          '%unknown pending user-input request%'
                      )
                    )
                  )
                  AND (
                    CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END >
                      CASE WHEN ranked.sequence IS NULL THEN 0 ELSE 1 END
                    OR (
                      CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END =
                        CASE WHEN ranked.sequence IS NULL THEN 0 ELSE 1 END
                      AND COALESCE(later.sequence, -1) > COALESCE(ranked.sequence, -1)
                    )
                    OR (
                      CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END =
                        CASE WHEN ranked.sequence IS NULL THEN 0 ELSE 1 END
                      AND COALESCE(later.sequence, -1) = COALESCE(ranked.sequence, -1)
                      AND later.created_at > ranked.created_at
                    )
                    OR (
                      CASE WHEN later.sequence IS NULL THEN 0 ELSE 1 END =
                        CASE WHEN ranked.sequence IS NULL THEN 0 ELSE 1 END
                      AND COALESCE(later.sequence, -1) = COALESCE(ranked.sequence, -1)
                      AND later.created_at = ranked.created_at
                      AND later.activity_id > ranked.activity_id
                    )
                  )
              )
            )
          )
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  return {
    listThreadMessageRowsByThread,
    listThreadProposedPlanRowsByThread,
    listThreadActivityRowsByThread,
  };
}

export type ThreadDetailQueries = ReturnType<typeof makeThreadDetailQueries>;
