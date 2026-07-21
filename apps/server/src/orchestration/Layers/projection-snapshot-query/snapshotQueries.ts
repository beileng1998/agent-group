import { Schema } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  MAX_THREAD_ACTIVITIES,
  MAX_THREAD_MESSAGES,
  ProjectionCheckpointDbRowSchema,
  ProjectionLatestTurnDbRowSchema,
  ProjectionProjectDbRowSchema,
  ProjectionStateDbRowSchema,
  ProjectionThreadActivityDbRowSchema,
  ProjectionThreadDbRowSchema,
  ProjectionThreadMessageDbRowSchema,
  ProjectionThreadProposedPlanDbRowSchema,
  ProjectionThreadSessionDbRowSchema,
  ProjectionThreadShellDbRowSchema,
} from "./projectionSnapshotRows.ts";

export function makeSnapshotQueries(sql: SqlClient.SqlClient) {
  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          kind,
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          is_pinned AS "isPinned",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          env_mode AS "envMode",
          branch,
          worktree_path AS "worktreePath",
          associated_worktree_path AS "associatedWorktreePath",
          associated_worktree_branch AS "associatedWorktreeBranch",
          associated_worktree_ref AS "associatedWorktreeRef",
          create_branch_flow_completed AS "createBranchFlowCompleted",
          is_pinned AS "isPinned",
          pinned_messages_json AS "pinnedMessages",
          thread_markers_json AS "threadMarkers",
          notes,
          parent_thread_id AS "parentThreadId",
          subagent_agent_id AS "subagentAgentId",
          subagent_nickname AS "subagentNickname",
          subagent_role AS "subagentRole",
          fork_source_thread_id AS "forkSourceThreadId",
          sidechat_source_thread_id AS "sidechatSourceThreadId",
          last_known_pr_json AS "lastKnownPr",
          latest_turn_id AS "latestTurnId",
          handoff_json AS "handoff",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadShellRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadShellDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          env_mode AS "envMode",
          branch,
          worktree_path AS "worktreePath",
          associated_worktree_path AS "associatedWorktreePath",
          associated_worktree_branch AS "associatedWorktreeBranch",
          associated_worktree_ref AS "associatedWorktreeRef",
          create_branch_flow_completed AS "createBranchFlowCompleted",
          is_pinned AS "isPinned",
          parent_thread_id AS "parentThreadId",
          subagent_agent_id AS "subagentAgentId",
          subagent_nickname AS "subagentNickname",
          subagent_role AS "subagentRole",
          fork_source_thread_id AS "forkSourceThreadId",
          sidechat_source_thread_id AS "sidechatSourceThreadId",
          last_known_pr_json AS "lastKnownPr",
          latest_turn_id AS "latestTurnId",
          handoff_json AS "handoff",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: () =>
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
        )
        WHERE message_rank <= ${MAX_THREAD_MESSAGES}
        ORDER BY thread_id ASC, created_at ASC, message_id ASC
      `,
  });

  const listThreadProposedPlanRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: () =>
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
        ORDER BY thread_id ASC, created_at ASC, plan_id ASC
      `,
  });

  const listThreadActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: () =>
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
        ) AS ranked
        WHERE activity_rank <= ${MAX_THREAD_ACTIVITIES}
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
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: () =>
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
        ORDER BY thread_id ASC
      `,
  });

  const listCheckpointRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCheckpointDbRowSchema,
    execute: () =>
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
        -- Provider-diff placeholders can reserve checkpoint metadata before the
        -- turn is complete; snapshot checkpoint summaries require completedAt.
        WHERE checkpoint_turn_count IS NOT NULL
          AND completed_at IS NOT NULL
        ORDER BY thread_id ASC, checkpoint_turn_count ASC
      `,
  });

  const listLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
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
        WHERE turn_id IS NOT NULL
        ORDER BY thread_id ASC, requested_at DESC, turn_id DESC
      `,
  });

  const listProjectionStateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionStateDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
      `,
  });

  return {
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
  };
}

export type SnapshotQueries = ReturnType<typeof makeSnapshotQueries>;
