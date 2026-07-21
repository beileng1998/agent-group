import type { OrchestrationEvent } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import {
  checkpointRefForThreadTurn,
  checkpointRefForThreadTurnInManagedFamily,
  checkpointRefForThreadTurnStart,
  checkpointRefForThreadTurnStartInManagedFamily,
  isManagedCheckpointRefForThread,
} from "../../../checkpointing/Utils.ts";
import type { CheckpointStoreShape } from "../../../checkpointing/Services/CheckpointStore.ts";
import type { ProviderServiceShape } from "../../../provider/Services/ProviderService.ts";
import { clearWorkspaceIndexCache } from "../../../workspaceEntries.ts";
import type { OrchestrationEngineShape } from "../../Services/OrchestrationEngine.ts";
import type { CheckpointLookup } from "./checkpointLookup.ts";
import type { CheckpointStatus } from "./checkpointStatus.ts";
import { serverCommandId } from "./checkpointReactorValues.ts";

export interface CheckpointRestoreDependencies {
  readonly checkpointStore: CheckpointStoreShape;
  readonly lookup: CheckpointLookup;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly providerService: ProviderServiceShape;
  readonly status: CheckpointStatus;
}

export function makeCheckpointRestoreHandler(dependencies: CheckpointRestoreDependencies) {
  const { checkpointStore, lookup, orchestrationEngine, providerService, status } = dependencies;

  return Effect.fnUntraced(function* (
    event: Extract<OrchestrationEvent, { type: "thread.checkpoint-revert-requested" }>,
  ) {
    const now = new Date().toISOString();
    const thread = yield* lookup.getThreadDetail(event.payload.threadId);
    if (!thread) {
      yield* status
        .appendRevertFailureActivity({
          threadId: event.payload.threadId,
          turnCount: event.payload.turnCount,
          detail: "Thread was not found in projection state.",
          createdAt: now,
        })
        .pipe(Effect.catch(() => Effect.void));
      return;
    }

    const currentTurnCount = thread.checkpoints.reduce(
      (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
      0,
    );
    if (event.payload.turnCount > currentTurnCount) {
      yield* status
        .appendRevertFailureActivity({
          threadId: event.payload.threadId,
          turnCount: event.payload.turnCount,
          detail: `Checkpoint turn count ${event.payload.turnCount} exceeds current turn count ${currentTurnCount}.`,
          createdAt: now,
        })
        .pipe(Effect.catch(() => Effect.void));
      return;
    }

    if (event.payload.scope === "files") {
      const project = yield* lookup.getProjectShell(thread.projectId);
      const checkpointCwd = project
        ? yield* lookup.resolveCheckpointCwd({
            threadId: event.payload.threadId,
            thread,
            project,
            preferSessionRuntime: true,
          })
        : undefined;
      if (!checkpointCwd) {
        yield* status
          .appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: "No git workspace is available for file Undo.",
            createdAt: now,
          })
          .pipe(Effect.catch(() => Effect.void));
        return;
      }

      const isUndoableCheckpoint = (checkpoint: (typeof thread.checkpoints)[number]) =>
        checkpoint.status === "ready" &&
        checkpoint.files.length > 0 &&
        isManagedCheckpointRefForThread(checkpoint.checkpointRef, event.payload.threadId);
      const targetCheckpoint = thread.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === event.payload.turnCount,
      );
      if (!targetCheckpoint || !isUndoableCheckpoint(targetCheckpoint)) {
        yield* status
          .appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: `File changes for turn ${event.payload.turnCount} are unavailable or already undone.`,
            createdAt: now,
          })
          .pipe(Effect.catch(() => Effect.void));
        return;
      }
      const latestUndoableTurnCount = thread.checkpoints.reduce(
        (latest, checkpoint) =>
          isUndoableCheckpoint(checkpoint)
            ? Math.max(latest, checkpoint.checkpointTurnCount)
            : latest,
        0,
      );
      if (targetCheckpoint.checkpointTurnCount !== latestUndoableTurnCount) {
        yield* status
          .appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: "Undo newer file changes before undoing this turn.",
            createdAt: now,
          })
          .pipe(Effect.catch(() => Effect.void));
        return;
      }

      const turnStartCheckpointRef =
        checkpointRefForThreadTurnStartInManagedFamily(
          targetCheckpoint.checkpointRef,
          event.payload.threadId,
          targetCheckpoint.turnId,
        ) ?? checkpointRefForThreadTurnStart(event.payload.threadId, targetCheckpoint.turnId);
      const hasTurnStartCheckpoint = yield* checkpointStore.hasCheckpointRef({
        cwd: checkpointCwd,
        checkpointRef: turnStartCheckpointRef,
      });
      const previousCheckpointRef =
        event.payload.turnCount === 1
          ? (checkpointRefForThreadTurnInManagedFamily(
              targetCheckpoint.checkpointRef,
              event.payload.threadId,
              0,
            ) ?? checkpointRefForThreadTurn(event.payload.threadId, 0))
          : thread.checkpoints.find(
              (checkpoint) => checkpoint.checkpointTurnCount === event.payload.turnCount - 1,
            )?.checkpointRef;
      const fromCheckpointRef = hasTurnStartCheckpoint
        ? turnStartCheckpointRef
        : previousCheckpointRef;
      if (!fromCheckpointRef) {
        yield* status
          .appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: `Starting checkpoint for turn ${event.payload.turnCount} is unavailable.`,
            createdAt: now,
          })
          .pipe(Effect.catch(() => Effect.void));
        return;
      }

      const reversed = yield* checkpointStore.reverseCheckpointDiff({
        cwd: checkpointCwd,
        fromCheckpointRef,
        toCheckpointRef: targetCheckpoint.checkpointRef,
      });
      if (!reversed) {
        yield* status
          .appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: `Filesystem checkpoints for turn ${event.payload.turnCount} are unavailable.`,
            createdAt: now,
          })
          .pipe(Effect.catch(() => Effect.void));
        return;
      }

      yield* checkpointStore.captureCheckpoint({
        cwd: checkpointCwd,
        checkpointRef: targetCheckpoint.checkpointRef,
      });
      yield* Effect.forEach(
        thread.checkpoints.filter(
          (checkpoint) =>
            checkpoint.checkpointTurnCount > targetCheckpoint.checkpointTurnCount &&
            isManagedCheckpointRefForThread(checkpoint.checkpointRef, event.payload.threadId),
        ),
        (checkpoint) => {
          const laterTurnStartCheckpointRef =
            checkpointRefForThreadTurnStartInManagedFamily(
              checkpoint.checkpointRef,
              event.payload.threadId,
              checkpoint.turnId,
            ) ?? checkpointRefForThreadTurnStart(event.payload.threadId, checkpoint.turnId);
          return Effect.all([
            checkpointStore.copyCheckpointRef({
              cwd: checkpointCwd,
              fromCheckpointRef: targetCheckpoint.checkpointRef,
              toCheckpointRef: checkpoint.checkpointRef,
            }),
            checkpointStore.copyCheckpointRef({
              cwd: checkpointCwd,
              fromCheckpointRef: targetCheckpoint.checkpointRef,
              toCheckpointRef: laterTurnStartCheckpointRef,
            }),
          ]).pipe(Effect.asVoid);
        },
        { discard: true },
      );

      clearWorkspaceIndexCache(checkpointCwd);
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: serverCommandId("checkpoint-files-undone"),
        threadId: event.payload.threadId,
        turnId: targetCheckpoint.turnId,
        completedAt: targetCheckpoint.completedAt,
        checkpointRef: targetCheckpoint.checkpointRef,
        status: targetCheckpoint.status,
        files: [],
        ...(targetCheckpoint.assistantMessageId
          ? { assistantMessageId: targetCheckpoint.assistantMessageId }
          : {}),
        checkpointTurnCount: targetCheckpoint.checkpointTurnCount,
        preserveLatestTurn: true,
        createdAt: now,
      });
      return;
    }

    const sessionRuntime = yield* lookup.resolveSessionRuntimeForThread(event.payload.threadId);
    if (Option.isNone(sessionRuntime)) {
      yield* status
        .appendRevertFailureActivity({
          threadId: event.payload.threadId,
          turnCount: event.payload.turnCount,
          detail: "No active provider session with workspace cwd is bound to this thread.",
          createdAt: now,
        })
        .pipe(Effect.catch(() => Effect.void));
      return;
    }
    if (!lookup.isGitWorkspace(sessionRuntime.value.cwd)) {
      yield* status
        .appendRevertFailureActivity({
          threadId: event.payload.threadId,
          turnCount: event.payload.turnCount,
          detail: "Checkpoints are unavailable because this project is not a git repository.",
          createdAt: now,
        })
        .pipe(Effect.catch(() => Effect.void));
      return;
    }

    const earliestManagedBaselineRef = thread.checkpoints
      .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
      .map((checkpoint) =>
        checkpointRefForThreadTurnInManagedFamily(
          checkpoint.checkpointRef,
          event.payload.threadId,
          0,
        ),
      )
      .find((checkpointRef) => checkpointRef !== null);
    const targetCheckpointRef =
      event.payload.turnCount === 0
        ? (earliestManagedBaselineRef ?? checkpointRefForThreadTurn(event.payload.threadId, 0))
        : thread.checkpoints.find(
            (checkpoint) => checkpoint.checkpointTurnCount === event.payload.turnCount,
          )?.checkpointRef;
    if (!targetCheckpointRef) {
      yield* status
        .appendRevertFailureActivity({
          threadId: event.payload.threadId,
          turnCount: event.payload.turnCount,
          detail: `Checkpoint ref for turn ${event.payload.turnCount} is unavailable in read model.`,
          createdAt: now,
        })
        .pipe(Effect.catch(() => Effect.void));
      return;
    }

    const restored = yield* checkpointStore.restoreCheckpoint({
      cwd: sessionRuntime.value.cwd,
      checkpointRef: targetCheckpointRef,
      fallbackToHead: event.payload.turnCount === 0,
    });
    if (!restored) {
      yield* status
        .appendRevertFailureActivity({
          threadId: event.payload.threadId,
          turnCount: event.payload.turnCount,
          detail: `Filesystem checkpoint is unavailable for turn ${event.payload.turnCount}.`,
          createdAt: now,
        })
        .pipe(Effect.catch(() => Effect.void));
      return;
    }

    clearWorkspaceIndexCache(sessionRuntime.value.cwd);
    const rolledBackTurns = Math.max(0, currentTurnCount - event.payload.turnCount);
    if (rolledBackTurns > 0) {
      yield* providerService.rollbackConversation({
        threadId: sessionRuntime.value.threadId,
        numTurns: rolledBackTurns,
      });
    }
    const staleCheckpointRefs = thread.checkpoints
      .filter((checkpoint) => checkpoint.checkpointTurnCount > event.payload.turnCount)
      .map((checkpoint) => checkpoint.checkpointRef);
    if (staleCheckpointRefs.length > 0) {
      yield* checkpointStore.deleteCheckpointRefs({
        cwd: sessionRuntime.value.cwd,
        checkpointRefs: staleCheckpointRefs,
      });
    }
    yield* orchestrationEngine
      .dispatch({
        type: "thread.revert.complete",
        commandId: serverCommandId("checkpoint-revert-complete"),
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        createdAt: now,
      })
      .pipe(
        Effect.catch((error) =>
          status.appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: error.message,
            createdAt: now,
          }),
        ),
        Effect.asVoid,
      );
  });
}

export type CheckpointRestoreHandler = ReturnType<typeof makeCheckpointRestoreHandler>;
