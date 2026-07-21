import {
  CheckpointRef,
  EventId,
  type MessageId,
  type ProviderRuntimeEvent,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Effect } from "effect";

import { parseCheckpointFilesFromUnifiedDiff } from "../../../checkpointing/Diffs.ts";
import {
  checkpointRefForThreadTurn,
  checkpointRefForThreadTurnLive,
  checkpointRefForThreadTurnStart,
} from "../../../checkpointing/Utils.ts";
import type { CheckpointStoreShape } from "../../../checkpointing/Services/CheckpointStore.ts";
import { clearWorkspaceIndexCache } from "../../../workspaceEntries.ts";
import type { OrchestrationEngineShape } from "../../Services/OrchestrationEngine.ts";
import type { RuntimeReceiptBusShape } from "../../Services/RuntimeReceiptBus.ts";
import type { CheckpointLookup } from "./checkpointLookup.ts";
import type { CheckpointStatus } from "./checkpointStatus.ts";
import {
  checkpointStatusFromRuntime,
  sameId,
  serverCommandId,
  toTurnId,
} from "./checkpointReactorValues.ts";

export interface CheckpointCaptureDependencies {
  readonly checkpointStore: CheckpointStoreShape;
  readonly lookup: CheckpointLookup;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly receiptBus: RuntimeReceiptBusShape;
  readonly status: CheckpointStatus;
}

export function makeCheckpointCaptureHandlers(dependencies: CheckpointCaptureDependencies) {
  const { checkpointStore, lookup, orchestrationEngine, receiptBus, status } = dependencies;

  const captureAndDispatchCheckpoint = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly thread: {
      readonly messages: ReadonlyArray<{
        readonly id: MessageId;
        readonly role: string;
        readonly turnId: TurnId | null;
      }>;
    };
    readonly cwd: string;
    readonly turnCount: number;
    readonly status: "ready" | "missing" | "error";
    readonly assistantMessageId: MessageId | undefined;
    readonly createdAt: string;
  }) {
    const fromCheckpointRef = checkpointRefForThreadTurnStart(input.threadId, input.turnId);
    const targetCheckpointRef = checkpointRefForThreadTurn(input.threadId, input.turnCount);
    const fromCheckpointExists = yield* checkpointStore.hasCheckpointRef({
      cwd: input.cwd,
      checkpointRef: fromCheckpointRef,
    });
    if (!fromCheckpointExists) {
      yield* Effect.logWarning("checkpoint capture missing pre-turn baseline", {
        threadId: input.threadId,
        turnId: input.turnId,
        checkpointRef: fromCheckpointRef,
      });
    }

    yield* checkpointStore.captureCheckpoint({
      cwd: input.cwd,
      checkpointRef: targetCheckpointRef,
    });
    clearWorkspaceIndexCache(input.cwd);
    const checkpointStatus = fromCheckpointExists ? input.status : ("missing" as const);
    const files = fromCheckpointExists
      ? yield* checkpointStore
          .diffCheckpoints({
            cwd: input.cwd,
            fromCheckpointRef,
            toCheckpointRef: targetCheckpointRef,
            fallbackFromToHead: false,
            ignoreWhitespace: false,
          })
          .pipe(
            Effect.map(parseCheckpointFilesFromUnifiedDiff),
            Effect.tapError((error) =>
              status.appendCaptureFailureActivity({
                threadId: input.threadId,
                turnId: input.turnId,
                detail: `Checkpoint captured, but turn diff summary is unavailable: ${error.message}`,
                createdAt: input.createdAt,
              }),
            ),
            Effect.catch((error) =>
              Effect.logWarning("failed to derive checkpoint file summary", {
                threadId: input.threadId,
                turnId: input.turnId,
                turnCount: input.turnCount,
                detail: error.message,
              }).pipe(Effect.as([])),
            ),
          )
      : yield* status
          .appendCaptureFailureActivity({
            threadId: input.threadId,
            turnId: input.turnId,
            detail: "Checkpoint captured, but the turn start baseline is unavailable.",
            createdAt: input.createdAt,
          })
          .pipe(Effect.as([]));

    const assistantMessageId = yield* status.resolveAssistantMessageIdForTurn({
      threadId: input.threadId,
      turnId: input.turnId,
      assistantMessageId:
        input.assistantMessageId ??
        input.thread.messages
          .toReversed()
          .find((entry) => entry.role === "assistant" && entry.turnId === input.turnId)?.id,
    });

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.diff.complete",
      commandId: serverCommandId("checkpoint-turn-diff-complete"),
      threadId: input.threadId,
      turnId: input.turnId,
      completedAt: input.createdAt,
      checkpointRef: targetCheckpointRef,
      status: checkpointStatus,
      files,
      assistantMessageId,
      checkpointTurnCount: input.turnCount,
      createdAt: input.createdAt,
    });
    yield* receiptBus.publish({
      type: "checkpoint.diff.finalized",
      threadId: input.threadId,
      turnId: input.turnId,
      checkpointTurnCount: input.turnCount,
      checkpointRef: targetCheckpointRef,
      status: checkpointStatus,
      createdAt: input.createdAt,
    });
    yield* receiptBus.publish({
      type: "turn.processing.quiesced",
      threadId: input.threadId,
      turnId: input.turnId,
      checkpointTurnCount: input.turnCount,
      createdAt: input.createdAt,
    });
    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("checkpoint-captured-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "info",
        kind: "checkpoint.captured",
        summary: "Checkpoint captured",
        payload: { turnCount: input.turnCount, status: checkpointStatus },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const ensureLegacyBaselineCheckpoint = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly turnCount: number;
    readonly createdAt: string;
  }) {
    const legacyBaselineRef = checkpointRefForThreadTurn(input.threadId, input.turnCount);
    if (
      yield* checkpointStore.hasCheckpointRef({ cwd: input.cwd, checkpointRef: legacyBaselineRef })
    ) {
      return;
    }
    yield* checkpointStore.captureCheckpoint({ cwd: input.cwd, checkpointRef: legacyBaselineRef });
    yield* receiptBus.publish({
      type: "checkpoint.baseline.captured",
      threadId: input.threadId,
      checkpointTurnCount: input.turnCount,
      checkpointRef: legacyBaselineRef,
      createdAt: input.createdAt,
    });
  });

  const captureCheckpointFromTurnCompletion = Effect.fnUntraced(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) {
    const turnId = toTurnId(event.turnId);
    if (!turnId) return;
    const thread = yield* lookup.getThreadDetail(event.threadId);
    if (!thread) {
      yield* Effect.logDebug("turn-completion checkpoint skipped: thread not found", {
        threadId: event.threadId,
        turnId,
      });
      return;
    }
    const project = yield* lookup.getProjectShell(thread.projectId);
    if (!project) {
      yield* Effect.logDebug("turn-completion checkpoint skipped: project not found", {
        threadId: thread.id,
        turnId,
        projectId: thread.projectId,
      });
      return;
    }
    if (thread.session?.activeTurnId && !sameId(thread.session.activeTurnId, turnId)) {
      yield* Effect.logDebug("turn-completion checkpoint skipped: turn is not the active turn", {
        threadId: thread.id,
        turnId,
        activeTurnId: thread.session.activeTurnId,
      });
      return;
    }
    if (
      thread.checkpoints.some(
        (checkpoint) => checkpoint.turnId === turnId && checkpoint.status !== "missing",
      )
    ) {
      return;
    }
    const checkpointCwd = yield* lookup.resolveCheckpointCwd({
      threadId: thread.id,
      thread,
      project,
      preferSessionRuntime: true,
    });
    if (!checkpointCwd) {
      yield* Effect.logDebug(
        "turn-completion checkpoint skipped: no git workspace to capture from",
        { threadId: thread.id, turnId, projectId: thread.projectId },
      );
      return;
    }
    const existingPlaceholder = thread.checkpoints.find(
      (checkpoint) => checkpoint.turnId === turnId && checkpoint.status === "missing",
    );
    const currentTurnCount = thread.checkpoints.reduce(
      (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
      0,
    );
    yield* captureAndDispatchCheckpoint({
      threadId: thread.id,
      turnId,
      thread,
      cwd: checkpointCwd,
      turnCount: existingPlaceholder
        ? existingPlaceholder.checkpointTurnCount
        : currentTurnCount + 1,
      status: checkpointStatusFromRuntime(event.payload.state),
      assistantMessageId: undefined,
      createdAt: event.createdAt,
    });
  });

  const captureLiveTurnDiff = Effect.fnUntraced(function* (
    event: Extract<ProviderRuntimeEvent, { type: "item.completed" }>,
  ) {
    const turnId = toTurnId(event.turnId);
    if (!turnId) return;
    const thread = yield* lookup.getThreadDetail(event.threadId);
    if (!thread) return;
    const project = yield* lookup.getProjectShell(thread.projectId);
    if (!project) return;
    if (thread.session?.activeTurnId && !sameId(thread.session.activeTurnId, turnId)) return;
    const existingForTurn = thread.checkpoints.find((checkpoint) => checkpoint.turnId === turnId);
    if (existingForTurn && existingForTurn.status !== "missing") return;
    const checkpointCwd = yield* lookup.resolveCheckpointCwd({
      threadId: thread.id,
      thread,
      project,
      preferSessionRuntime: true,
    });
    if (!checkpointCwd) return;
    const fromCheckpointRef = checkpointRefForThreadTurnStart(thread.id, turnId);
    if (
      !(yield* checkpointStore.hasCheckpointRef({
        cwd: checkpointCwd,
        checkpointRef: fromCheckpointRef,
      }))
    ) {
      return;
    }
    const liveCheckpointRef = checkpointRefForThreadTurnLive(thread.id, turnId);
    yield* checkpointStore.captureCheckpoint({
      cwd: checkpointCwd,
      checkpointRef: liveCheckpointRef,
    });
    const diff = yield* checkpointStore
      .diffCheckpoints({
        cwd: checkpointCwd,
        fromCheckpointRef,
        toCheckpointRef: liveCheckpointRef,
        fallbackFromToHead: false,
        ignoreWhitespace: false,
      })
      .pipe(Effect.catch(() => Effect.succeed("")));
    yield* checkpointStore
      .deleteCheckpointRefs({ cwd: checkpointCwd, checkpointRefs: [liveCheckpointRef] })
      .pipe(Effect.catch(() => Effect.void));
    const files = parseCheckpointFilesFromUnifiedDiff(diff);
    if (files.length === 0) return;
    const maxTurnCount = thread.checkpoints.reduce(
      (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
      0,
    );
    yield* orchestrationEngine.dispatch({
      type: "thread.turn.diff.complete",
      commandId: serverCommandId("checkpoint-live-turn-diff"),
      threadId: thread.id,
      turnId,
      completedAt: event.createdAt,
      checkpointRef: CheckpointRef.makeUnsafe(`provider-diff:${event.eventId}`),
      status: "missing",
      files,
      assistantMessageId: undefined,
      checkpointTurnCount: existingForTurn ? existingForTurn.checkpointTurnCount : maxTurnCount + 1,
      createdAt: event.createdAt,
    });
  });

  const captureCheckpointFromPlaceholder = Effect.fnUntraced(function* (
    event: Extract<
      import("@agent-group/contracts").OrchestrationEvent,
      { type: "thread.turn-diff-completed" }
    >,
  ) {
    if (event.payload.status === "missing") {
      yield* Effect.logDebug("checkpoint placeholder left unresolved until turn completion", {
        threadId: event.payload.threadId,
        turnId: event.payload.turnId,
        checkpointTurnCount: event.payload.checkpointTurnCount,
      });
    }
  });

  return {
    captureCheckpointFromPlaceholder,
    captureCheckpointFromTurnCompletion,
    captureLiveTurnDiff,
    ensureLegacyBaselineCheckpoint,
  };
}

export type CheckpointCaptureHandlers = ReturnType<typeof makeCheckpointCaptureHandlers>;
