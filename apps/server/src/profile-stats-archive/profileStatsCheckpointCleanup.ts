import {
  CheckpointRef,
  MessageId,
  ThreadId,
  TurnId,
  type ThreadEnvironmentMode,
} from "@agent-group/contracts";
import { resolveThreadWorkspaceCwd } from "@agent-group/shared/threadEnvironment";
import { Cause, Effect } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import type { CheckpointStoreShape } from "../checkpointing/Services/CheckpointStore";
import {
  checkpointRefForThreadMessageStart,
  checkpointRefForThreadTurnStart,
  isManagedCheckpointRefForThread,
  resolveProjectCwdForKind,
} from "../checkpointing/Utils";

interface PurgeThreadRow {
  readonly projectId: string | null;
  readonly modelSelectionJson: string | null;
  readonly deletedAt: string | null;
  readonly envMode: string | null;
  readonly worktreePath: string | null;
  readonly projectKind: string | null;
  readonly workspaceRoot: string | null;
}

interface CheckpointTurnRow {
  readonly turnId: string | null;
  readonly checkpointRef: string | null;
}

interface CheckpointMessageRow {
  readonly messageId: string | null;
}

interface ThreadCheckpointCleanup {
  readonly cwd: string | null;
  readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeThreadEnvironmentMode(value: string | null): ThreadEnvironmentMode | undefined {
  return value === "local" || value === "worktree" ? value : undefined;
}

function threadWorkspaceCwdForCheckpointCleanup(thread: PurgeThreadRow): string | null {
  const projectCwd = resolveProjectCwdForKind({
    kind: thread.projectKind,
    workspaceRoot: thread.workspaceRoot,
    worktreePath: thread.worktreePath,
  });
  return resolveThreadWorkspaceCwd({
    projectCwd,
    envMode: normalizeThreadEnvironmentMode(thread.envMode),
    worktreePath: thread.worktreePath,
  });
}

function checkpointRefsForThreadPurge(
  threadId: string,
  turnRows: ReadonlyArray<CheckpointTurnRow>,
  messageRows: ReadonlyArray<CheckpointMessageRow>,
): ReadonlyArray<CheckpointRef> {
  const refs = new Set<string>();
  const typedThreadId = ThreadId.makeUnsafe(threadId);

  const addRef = (checkpointRef: CheckpointRef | string | null | undefined) => {
    const raw = readString(checkpointRef);
    if (raw && isManagedCheckpointRefForThread(raw, typedThreadId)) {
      refs.add(raw);
    }
  };

  for (const row of turnRows) {
    const checkpointRef = readString(row.checkpointRef);
    addRef(checkpointRef);

    const turnId = readString(row.turnId);
    if (turnId) {
      addRef(checkpointRefForThreadTurnStart(typedThreadId, TurnId.makeUnsafe(turnId)));
    }
  }
  for (const row of messageRows) {
    const messageId = readString(row.messageId);
    if (messageId) {
      addRef(checkpointRefForThreadMessageStart(typedThreadId, MessageId.makeUnsafe(messageId)));
    }
  }

  return [...refs].map((checkpointRef) => CheckpointRef.makeUnsafe(checkpointRef));
}

export function makeProfileStatsCheckpointCleanup(input: {
  readonly sql: SqlClient.SqlClient;
  readonly checkpointStore: CheckpointStoreShape;
}) {
  const loadThreadCheckpointCleanup = (threadId: string) =>
    Effect.gen(function* () {
      const threadRows = yield* input.sql<PurgeThreadRow>`
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
        return null;
      }

      const checkpointTurnRows = yield* input.sql<CheckpointTurnRow>`
        SELECT
          turn_id AS turnId,
          checkpoint_ref AS checkpointRef
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND (
            turn_id IS NOT NULL
            OR checkpoint_ref IS NOT NULL
          )
        ORDER BY row_id ASC
      `;
      const checkpointMessageRows = yield* input.sql<CheckpointMessageRow>`
        SELECT message_id AS messageId
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
          AND message_id IS NOT NULL
        ORDER BY message_id ASC
      `;

      const cwd = threadWorkspaceCwdForCheckpointCleanup(thread);
      const typedThreadId = ThreadId.makeUnsafe(threadId);
      const hasPersistedCheckpointRef = checkpointTurnRows.some((row) => {
        const checkpointRef = readString(row.checkpointRef);
        return checkpointRef
          ? isManagedCheckpointRefForThread(checkpointRef, typedThreadId)
          : false;
      });
      const checkpointRefs =
        cwd !== null || hasPersistedCheckpointRef
          ? checkpointRefsForThreadPurge(threadId, checkpointTurnRows, checkpointMessageRows)
          : [];

      return {
        cwd,
        checkpointRefs,
      } satisfies ThreadCheckpointCleanup;
    });

  // Stale/missing workspaces cannot contain reachable refs for us to delete; keep
  // the DB purge moving, but fail normally once a usable Git repo is confirmed.
  const deleteCheckpointRefsForPurge = (cleanup: {
    readonly threadId: string;
    readonly cwd: string | null;
    readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
  }) => {
    if (cleanup.checkpointRefs.length === 0) {
      return Effect.void;
    }
    const cwd = cleanup.cwd;
    if (cwd === null) {
      return Effect.logWarning(
        "profile stats archive skipped checkpoint ref cleanup because workspace is unavailable",
        { threadId: cleanup.threadId, checkpointRefCount: cleanup.checkpointRefs.length },
      );
    }

    return Effect.gen(function* () {
      const isGitRepository = yield* input.checkpointStore.isGitRepository(cwd).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning(
            "profile stats archive could not verify checkpoint cleanup workspace",
            {
              threadId: cleanup.threadId,
              cwd,
              cause: Cause.pretty(cause),
            },
          ).pipe(Effect.as(false));
        }),
      );
      if (!isGitRepository) {
        yield* Effect.logWarning(
          "profile stats archive skipped checkpoint ref cleanup because workspace is not a git repository",
          { threadId: cleanup.threadId, cwd },
        );
        return;
      }

      yield* input.checkpointStore.deleteCheckpointRefs({
        cwd,
        checkpointRefs: cleanup.checkpointRefs,
      });
    });
  };

  const deleteCheckpointRefsAfterCommittedPurge = (cleanup: {
    readonly threadId: string;
    readonly cwd: string | null;
    readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
  }) =>
    deleteCheckpointRefsForPurge(cleanup).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning(
          "profile stats archive could not delete checkpoint refs after purge",
          {
            threadId: cleanup.threadId,
            checkpointRefCount: cleanup.checkpointRefs.length,
            cause: Cause.pretty(cause),
          },
        );
      }),
    );

  return {
    loadThreadCheckpointCleanup,
    deleteCheckpointRefsAfterCommittedPurge,
  };
}
