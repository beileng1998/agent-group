import {
  type CommandId,
  type OrchestrationEvent,
  type OrchestrationThread,
  ProviderKind,
  type ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { collectTailTurnIds } from "@agent-group/shared/conversationEdit";
import { Effect, Schema } from "effect";

import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import type { CheckpointStoreShape } from "../../checkpointing/Services/CheckpointStore.ts";
import type { ProviderServiceError } from "../../provider/Errors.ts";
import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import { clearWorkspaceIndexCache } from "../../workspaceEntries.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import type { ProviderTurnBootstrapState } from "./providerTurnBootstrapState.ts";

export type ConversationRollbackRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.conversation-rollback-requested" }
>;

function isStaleCodexResumeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("thread/resume") &&
    (normalized.includes("no rollout found") ||
      normalized.includes("thread not found") ||
      normalized.includes("missing thread") ||
      normalized.includes("unknown thread"))
  );
}

function isRollbackStillInProgressError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("rollback") &&
    (normalized.includes("turn is in progress") ||
      normalized.includes("turn in progress") ||
      normalized.includes("active turn"))
  );
}

/** Owns provider transcript rollback and matching filesystem checkpoint restore. */
export function makeProviderConversationRollback<
  ResolveError,
  ProviderThreadError,
  WorkspaceError,
  ClearError,
>(dependencies: {
  readonly providerService: ProviderServiceShape;
  readonly checkpointStore: CheckpointStoreShape;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly bootstrapState: ProviderTurnBootstrapState;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ResolveError>;
  readonly resolveProviderSessionThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | null, ProviderThreadError>;
  readonly resolveSubagentProviderThreadId: (
    threadId: ThreadId,
    parentThreadId: ThreadId | null | undefined,
  ) => string | undefined;
  readonly resolveProjectedThreadWorkspaceCwd: (
    thread: Pick<OrchestrationThread, "projectId">,
  ) => Effect.Effect<string | undefined, WorkspaceError>;
  readonly clearStaleProviderResumeState: (input: {
    readonly threadId: ThreadId;
    readonly cause: ProviderServiceError;
  }) => Effect.Effect<unknown, ClearError>;
  readonly serverCommandId: (tag: string) => CommandId;
}) {
  const removedTurnIdsFromMessage = (
    messages: ReadonlyArray<{ readonly id: string; readonly turnId?: TurnId | null }>,
    messageId: string,
  ): TurnId[] => collectTailTurnIds<TurnId>({ messages, messageId });

  const rollbackProviderConversationForEdit = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly numTurns: number;
  }) {
    const projectedThread = yield* dependencies.resolveThread(input.threadId);
    const provider = projectedThread
      ? Schema.is(ProviderKind)(projectedThread.session?.providerName)
        ? projectedThread.session?.providerName
        : projectedThread.modelSelection.provider
      : undefined;
    const rebuildsContext =
      provider !== undefined &&
      (yield* dependencies.providerService.getCapabilities(provider)).conversationRollback ===
        "restart-session";
    let attempt = 0;
    while (true) {
      let rollbackError: ProviderServiceError | null = null;
      yield* dependencies.providerService
        .rollbackConversation({ threadId: input.threadId, numTurns: input.numTurns })
        .pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              rollbackError = error;
            }),
          ),
        );
      if (rollbackError === null) {
        if (rebuildsContext) dependencies.bootstrapState.registerRollback(input.threadId);
        return;
      }
      if (isStaleCodexResumeError(rollbackError)) {
        yield* dependencies.clearStaleProviderResumeState({
          threadId: input.threadId,
          cause: rollbackError,
        });
        return;
      }
      if (isRollbackStillInProgressError(rollbackError) && attempt < 30) {
        attempt += 1;
        yield* Effect.sleep(100);
        continue;
      }
      return yield* Effect.fail(rollbackError);
    }
  });

  const restoreWorkspaceBeforeEditReplay = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly removedTurnIds: ReadonlyArray<TurnId>;
  }) {
    if (input.removedTurnIds.length === 0) return;
    const thread = yield* dependencies.resolveThread(input.threadId);
    if (!thread) return;
    const removedTurnIdSet = new Set(input.removedTurnIds);
    const removedCheckpoints = thread.checkpoints.filter((checkpoint) =>
      removedTurnIdSet.has(checkpoint.turnId),
    );
    if (removedCheckpoints.length === 0) return;
    const firstRemovedTurnCount = removedCheckpoints.reduce(
      (minTurnCount, checkpoint) => Math.min(minTurnCount, checkpoint.checkpointTurnCount),
      Number.POSITIVE_INFINITY,
    );
    const targetTurnCount = Math.max(0, firstRemovedTurnCount - 1);
    const cwd = yield* dependencies.resolveProjectedThreadWorkspaceCwd(thread);
    if (!cwd || !(yield* dependencies.checkpointStore.isGitRepository(cwd))) return;
    const targetCheckpointRef =
      targetTurnCount === 0
        ? checkpointRefForThreadTurn(input.threadId, 0)
        : thread.checkpoints.find(
            (checkpoint) => checkpoint.checkpointTurnCount === targetTurnCount,
          )?.checkpointRef;
    if (!targetCheckpointRef) {
      return yield* Effect.fail(
        new Error(`Checkpoint ref for edit replay turn ${targetTurnCount} is unavailable.`),
      );
    }
    const restored = yield* dependencies.checkpointStore.restoreCheckpoint({
      cwd,
      checkpointRef: targetCheckpointRef,
      fallbackToHead: targetTurnCount === 0,
    });
    if (!restored) {
      return yield* Effect.fail(
        new Error(`Filesystem checkpoint is unavailable for edit replay turn ${targetTurnCount}.`),
      );
    }
    clearWorkspaceIndexCache(cwd);
  });

  const processConversationRollbackRequested = Effect.fnUntraced(function* (
    event: ConversationRollbackRequestedEvent,
  ) {
    const thread = yield* dependencies.resolveThread(event.payload.threadId);
    if (event.payload.numTurns === 0) {
      yield* dependencies.orchestrationEngine.dispatch({
        type: "thread.conversation.rollback.complete",
        commandId: dependencies.serverCommandId("conversation-rollback-complete"),
        threadId: event.payload.threadId,
        messageId: event.payload.messageId,
        numTurns: event.payload.numTurns,
        removedTurnIds: thread
          ? removedTurnIdsFromMessage(thread.messages, event.payload.messageId)
          : [],
        createdAt: event.payload.createdAt,
      });
      return;
    }

    const providerThread = yield* dependencies.resolveProviderSessionThread(event.payload.threadId);
    if (
      thread &&
      providerThread?.session?.status === "running" &&
      providerThread.session.activeTurnId !== null
    ) {
      const providerThreadId = dependencies.resolveSubagentProviderThreadId(
        thread.id,
        providerThread.id,
      );
      yield* dependencies.providerService.interruptTurn({
        threadId: providerThread.id,
        turnId: providerThread.session.activeTurnId,
        ...(providerThreadId ? { providerThreadId } : {}),
      });
    }
    yield* rollbackProviderConversationForEdit({
      threadId: event.payload.threadId,
      numTurns: event.payload.numTurns,
    });
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.conversation.rollback.complete",
      commandId: dependencies.serverCommandId("conversation-rollback-complete"),
      threadId: event.payload.threadId,
      messageId: event.payload.messageId,
      numTurns: event.payload.numTurns,
      removedTurnIds: thread
        ? removedTurnIdsFromMessage(thread.messages, event.payload.messageId)
        : [],
      createdAt: event.payload.createdAt,
    });
  });

  return {
    processConversationRollbackRequested,
    restoreWorkspaceBeforeEditReplay,
    rollbackProviderConversationForEdit,
  } as const;
}
