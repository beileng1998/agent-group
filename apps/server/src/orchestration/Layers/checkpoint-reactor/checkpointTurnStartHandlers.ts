import type { OrchestrationEvent, ProviderRuntimeEvent } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import {
  checkpointRefForThreadMessageStart,
  checkpointRefForThreadTurnStart,
} from "../../../checkpointing/Utils.ts";
import type { CheckpointStoreShape } from "../../../checkpointing/Services/CheckpointStore.ts";
import type { ProjectionTurnRepositoryShape } from "../../../persistence/Services/ProjectionTurns.ts";
import type { CheckpointCaptureHandlers } from "./checkpointCaptureHandlers.ts";
import type { CheckpointLookup } from "./checkpointLookup.ts";
import type { CheckpointReactorState } from "./checkpointReactorValues.ts";
import { toTurnId } from "./checkpointReactorValues.ts";

export interface CheckpointTurnStartDependencies {
  readonly capture: CheckpointCaptureHandlers;
  readonly checkpointStore: CheckpointStoreShape;
  readonly lookup: CheckpointLookup;
  readonly projectionTurnRepository: ProjectionTurnRepositoryShape;
  readonly state: CheckpointReactorState;
}

export function makeCheckpointTurnStartHandlers(dependencies: CheckpointTurnStartDependencies) {
  const { capture, checkpointStore, lookup, projectionTurnRepository, state } = dependencies;

  const ensurePreTurnBaselineFromTurnStart = Effect.fnUntraced(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.started" }>,
  ) {
    const turnId = toTurnId(event.turnId);
    if (!turnId) {
      return;
    }
    const thread = yield* lookup.getThreadDetail(event.threadId);
    if (!thread) {
      return;
    }
    const project = yield* lookup.getProjectShell(thread.projectId);
    if (!project) {
      return;
    }
    const checkpointCwd = yield* lookup.resolveCheckpointCwd({
      threadId: thread.id,
      thread,
      project,
      preferSessionRuntime: false,
    });
    if (!checkpointCwd) {
      return;
    }

    const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
      threadId: thread.id,
    });
    const messageId =
      state.pendingMessageStartByThread.get(thread.id) ??
      Option.match(pendingTurnStart, {
        onNone: () => undefined,
        onSome: (pending) => pending.messageId,
      });
    const turnStartCheckpointRef = checkpointRefForThreadTurnStart(thread.id, turnId);
    let hasTurnStartBaseline = false;
    if (messageId !== undefined) {
      const messageStartCheckpointRef = checkpointRefForThreadMessageStart(thread.id, messageId);
      const copyMessageStartBaseline = checkpointStore.copyCheckpointRef({
        cwd: checkpointCwd,
        fromCheckpointRef: messageStartCheckpointRef,
        toCheckpointRef: turnStartCheckpointRef,
      });
      let copied = yield* copyMessageStartBaseline;
      if (!copied) {
        yield* checkpointStore.captureCheckpoint({
          cwd: checkpointCwd,
          checkpointRef: messageStartCheckpointRef,
          skipIfExists: true,
        });
        copied = yield* copyMessageStartBaseline;
      }
      hasTurnStartBaseline = copied;
      state.pendingMessageStartByThread.delete(thread.id);
      if (!copied) {
        yield* Effect.logWarning("checkpoint turn start baseline alias missing message baseline", {
          threadId: thread.id,
          turnId,
          messageId,
        });
      }
    }
    if (!hasTurnStartBaseline) {
      const existingTurnStartBaseline = yield* checkpointStore.hasCheckpointRef({
        cwd: checkpointCwd,
        checkpointRef: turnStartCheckpointRef,
      });
      if (!existingTurnStartBaseline) {
        yield* checkpointStore.captureCheckpoint({
          cwd: checkpointCwd,
          checkpointRef: turnStartCheckpointRef,
        });
      }
    }

    const currentTurnCount = thread.checkpoints.reduce(
      (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
      0,
    );
    yield* capture.ensureLegacyBaselineCheckpoint({
      threadId: thread.id,
      cwd: checkpointCwd,
      turnCount: currentTurnCount,
      createdAt: event.createdAt,
    });
  });

  const ensurePreTurnBaselineFromDomainTurnStart = Effect.fnUntraced(function* (
    event: Extract<
      OrchestrationEvent,
      { type: "thread.turn-start-requested" | "thread.message-sent" }
    >,
  ) {
    if (event.type === "thread.message-sent") {
      if (
        event.payload.role !== "user" ||
        event.payload.streaming ||
        event.payload.turnId !== null
      ) {
        return;
      }
    }

    const threadId = event.payload.threadId;
    const thread = yield* lookup.getThreadDetail(threadId);
    if (!thread) {
      return;
    }
    const project = yield* lookup.getProjectShell(thread.projectId);
    if (!project) {
      return;
    }
    const checkpointCwd = yield* lookup.resolveCheckpointCwd({
      threadId,
      thread,
      project,
      preferSessionRuntime: false,
    });
    if (!checkpointCwd) {
      return;
    }

    if (event.type === "thread.turn-start-requested") {
      state.pendingMessageStartByThread.set(threadId, event.payload.messageId);
      const messageStartCheckpointRef = checkpointRefForThreadMessageStart(
        threadId,
        event.payload.messageId,
      );
      const messageStartCheckpointExists = yield* checkpointStore.hasCheckpointRef({
        cwd: checkpointCwd,
        checkpointRef: messageStartCheckpointRef,
      });
      if (!messageStartCheckpointExists) {
        yield* checkpointStore.captureCheckpoint({
          cwd: checkpointCwd,
          checkpointRef: messageStartCheckpointRef,
          skipIfExists: true,
        });
      }
    }

    const currentTurnCount = thread.checkpoints.reduce(
      (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
      0,
    );
    yield* capture.ensureLegacyBaselineCheckpoint({
      threadId,
      cwd: checkpointCwd,
      turnCount: currentTurnCount,
      createdAt: event.occurredAt,
    });
  });

  return {
    ensurePreTurnBaselineFromDomainTurnStart,
    ensurePreTurnBaselineFromTurnStart,
  };
}

export type CheckpointTurnStartHandlers = ReturnType<typeof makeCheckpointTurnStartHandlers>;
