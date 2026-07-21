import {
  type CommandId,
  type OrchestrationEvent,
  type OrchestrationSession,
  type OrchestrationThread,
  ProviderKind,
  type ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { resolveTailUserMessageEditTarget } from "@agent-group/shared/conversationEdit";
import { Effect, Schema } from "effect";

import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import type { ProviderTurnBootstrapState } from "./providerTurnBootstrapState.ts";
import type { ProviderTurnQueue } from "./providerTurnQueue.ts";

export type MessageEditResendRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.message-edit-resend-requested" }
>;
type MessageEditResendPayload = MessageEditResendRequestedEvent["payload"];

/** Owns edit-tail validation, rollback, workspace restore, and resend admission. */
export function makeProviderMessageEdit<
  ResolveError,
  ProviderThreadError,
  SessionError,
  RollbackError,
  RestoreError,
>(dependencies: {
  readonly providerService: ProviderServiceShape;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly bootstrapState: ProviderTurnBootstrapState;
  readonly turnQueue: ProviderTurnQueue;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ResolveError>;
  readonly resolveProviderSessionThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | null, ProviderThreadError>;
  readonly setThreadSession: (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, SessionError>;
  readonly rollbackProviderConversationForEdit: (input: {
    readonly threadId: ThreadId;
    readonly numTurns: number;
  }) => Effect.Effect<unknown, RollbackError>;
  readonly restoreWorkspaceBeforeEditReplay: (input: {
    readonly threadId: ThreadId;
    readonly removedTurnIds: ReadonlyArray<TurnId>;
  }) => Effect.Effect<unknown, RestoreError>;
  readonly serverCommandId: (tag: string) => CommandId;
}) {
  const processMessageEditResendPayload = Effect.fnUntraced(function* (
    payload: MessageEditResendPayload,
    options?: {
      readonly skipProviderRollback?: boolean;
      readonly preserveQueuedTurns?: boolean;
      readonly preserveThreadSession?: boolean;
      readonly activeTurnId?: TurnId | null;
    },
  ) {
    if (options?.preserveQueuedTurns !== true) {
      dependencies.turnQueue.deleteQueuedTurns(payload.threadId);
      dependencies.turnQueue.clearEditResends(payload.threadId);
    } else {
      dependencies.turnQueue.remove(payload.threadId, payload.messageId);
    }
    const originalThread = yield* dependencies.resolveThread(payload.threadId);
    const originalMessage = originalThread?.messages.find(
      (message) => message.id === payload.messageId,
    );
    if (!originalThread || !originalMessage || originalMessage.role !== "user") {
      return yield* Effect.fail(
        new Error(`Cannot edit missing user message '${payload.messageId}'.`),
      );
    }
    const editTarget =
      payload.removedTurnIds !== undefined && payload.rollbackTurnCount !== undefined
        ? {
            editable: true as const,
            messageId: payload.messageId,
            messageIndex: originalThread.messages.findIndex(
              (message) => message.id === payload.messageId,
            ),
            mode: payload.rollbackTurnCount > 0 ? ("rollback" as const) : ("active" as const),
            rollbackTurnCount: payload.rollbackTurnCount,
            removedTurnIds: payload.removedTurnIds,
          }
        : resolveTailUserMessageEditTarget({
            messages: originalThread.messages,
            messageId: payload.messageId,
            activeTurnId:
              options?.activeTurnId ??
              (originalThread.session?.status === "running"
                ? (originalThread.session.activeTurnId ?? null)
                : null),
          });
    if (!editTarget.editable) {
      return yield* Effect.fail(
        new Error(
          `Cannot edit non-tail user message '${payload.messageId}': ${editTarget.reason}.`,
        ),
      );
    }
    if (options?.skipProviderRollback !== true && editTarget.rollbackTurnCount > 0) {
      yield* dependencies.rollbackProviderConversationForEdit({
        threadId: payload.threadId,
        numTurns: editTarget.rollbackTurnCount,
      });
    }
    const removedTurnIds = editTarget.removedTurnIds.map((turnId) => TurnId.makeUnsafe(turnId));
    yield* dependencies.restoreWorkspaceBeforeEditReplay({
      threadId: payload.threadId,
      removedTurnIds,
    });
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.conversation.rollback.complete",
      commandId: dependencies.serverCommandId("message-edit-rollback-complete"),
      threadId: payload.threadId,
      messageId: payload.messageId,
      numTurns: editTarget.rollbackTurnCount,
      removedTurnIds,
      skipAttachmentPrune: true,
      createdAt: payload.createdAt,
    });

    const thread = yield* dependencies.resolveThread(payload.threadId);
    if (thread && options?.preserveThreadSession !== true) {
      yield* dependencies.setThreadSession({
        threadId: payload.threadId,
        session: {
          threadId: payload.threadId,
          status: "starting",
          providerName: thread.session?.providerName ?? thread.modelSelection.provider,
          runtimeMode: payload.runtimeMode,
          activeTurnId: null,
          lastError: null,
          updatedAt: payload.createdAt,
        },
        createdAt: payload.createdAt,
      });
    }

    dependencies.turnQueue.trackEditResend(payload.threadId, payload.messageId);
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: dependencies.serverCommandId("message-edit-resend-turn-start"),
      threadId: payload.threadId,
      message: {
        messageId: payload.messageId,
        role: "user",
        text: payload.text,
        attachments: originalMessage.attachments ?? [],
        ...(originalMessage.skills !== undefined ? { skills: originalMessage.skills } : {}),
        ...(payload.mentions !== undefined
          ? { mentions: payload.mentions }
          : originalMessage.mentions !== undefined
            ? { mentions: originalMessage.mentions }
            : {}),
      },
      ...(payload.modelSelection !== undefined ? { modelSelection: payload.modelSelection } : {}),
      ...(payload.providerOptions !== undefined
        ? { providerOptions: payload.providerOptions }
        : {}),
      ...(payload.assistantDeliveryMode !== undefined
        ? { assistantDeliveryMode: payload.assistantDeliveryMode }
        : {}),
      dispatchMode: "queue",
      runtimeMode: payload.runtimeMode,
      interactionMode: payload.interactionMode,
      createdAt: payload.createdAt,
    });
  });

  const stopActiveProviderRuntimeForEdit = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
  }) {
    const thread = yield* dependencies.resolveThread(input.threadId);
    const provider = thread
      ? Schema.is(ProviderKind)(thread.session?.providerName)
        ? thread.session?.providerName
        : thread.modelSelection.provider
      : undefined;
    const rebuildsContext =
      provider !== undefined &&
      (yield* dependencies.providerService.getCapabilities(provider)).conversationRollback ===
        "restart-session";
    if (rebuildsContext && dependencies.providerService.clearSessionResumeCursor) {
      yield* dependencies.providerService.clearSessionResumeCursor({ threadId: input.threadId });
      dependencies.bootstrapState.registerRollback(input.threadId);
      return;
    }
    if (dependencies.providerService.stopRuntimeSession) {
      yield* dependencies.providerService.stopRuntimeSession({ threadId: input.threadId });
      return;
    }
    yield* dependencies.providerService.stopSession({ threadId: input.threadId });
  });

  const processMessageEditResendRequested = Effect.fnUntraced(function* (
    event: MessageEditResendRequestedEvent,
  ) {
    const thread = yield* dependencies.resolveThread(event.payload.threadId);
    const providerThread = yield* dependencies.resolveProviderSessionThread(event.payload.threadId);
    const activeTurnId =
      providerThread?.session?.status === "running"
        ? (providerThread.session.activeTurnId ?? null)
        : null;
    const isQueuedMessageEdit = dependencies.turnQueue.has(
      event.payload.threadId,
      event.payload.messageId,
    );
    if (thread && !isQueuedMessageEdit) {
      yield* dependencies.setThreadSession({
        threadId: event.payload.threadId,
        session: {
          threadId: event.payload.threadId,
          status: "starting",
          providerName: thread.session?.providerName ?? thread.modelSelection.provider,
          runtimeMode: event.payload.runtimeMode,
          activeTurnId: null,
          lastError: null,
          updatedAt: event.payload.createdAt,
        },
        createdAt: event.payload.createdAt,
      });
    }
    if (
      thread &&
      providerThread?.session?.status === "running" &&
      providerThread.session.activeTurnId !== null &&
      !isQueuedMessageEdit
    ) {
      yield* stopActiveProviderRuntimeForEdit({ threadId: providerThread.id });
      yield* processMessageEditResendPayload(event.payload, {
        skipProviderRollback: true,
        activeTurnId,
      });
      return;
    }
    yield* processMessageEditResendPayload(event.payload, {
      ...(isQueuedMessageEdit ? { skipProviderRollback: true } : {}),
      preserveQueuedTurns: isQueuedMessageEdit,
      preserveThreadSession: isQueuedMessageEdit,
      activeTurnId,
    });
  });

  return { processMessageEditResendRequested } as const;
}
