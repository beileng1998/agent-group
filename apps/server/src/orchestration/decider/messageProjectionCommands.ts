import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@agent-group/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { requireThread } from "../commandInvariants.ts";
import { resolveStableMessageTurnId } from "../messageTurnId.ts";
import { type DeciderResult, withEventBase } from "./common.ts";

type MessageProjectionCommand = Extract<
  OrchestrationCommand,
  {
    type:
      | "thread.message.assistant.delta"
      | "thread.message.assistant.complete"
      | "thread.proposed-plan.upsert"
      | "thread.turn.diff.complete"
      | "thread.revert.complete"
      | "thread.conversation.rollback.complete"
      | "thread.activity.append";
  }
>;

export const decideMessageProjectionCommand = Effect.fn("decideMessageProjectionCommand")(
  function* ({
    command,
    readModel,
  }: {
    readonly command: MessageProjectionCommand;
    readonly readModel: OrchestrationReadModel;
  }): Effect.fn.Return<DeciderResult, OrchestrationCommandInvariantError> {
    switch (command.type) {
      case "thread.message.assistant.delta": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const existingMessage = thread.messages.find((message) => message.id === command.messageId);
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.message-sent",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            role: "assistant",
            text: command.delta,
            turnId: resolveStableMessageTurnId({
              existingTurnId: existingMessage?.turnId,
              incomingTurnId: command.turnId,
            }),
            streaming: true,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }

      case "thread.message.assistant.complete": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const existingMessage = thread.messages.find((message) => message.id === command.messageId);
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.message-sent",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            role: "assistant",
            text: existingMessage?.text ?? "",
            turnId: resolveStableMessageTurnId({
              existingTurnId: existingMessage?.turnId,
              incomingTurnId: command.turnId,
            }),
            streaming: false,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }

      case "thread.proposed-plan.upsert": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.proposed-plan-upserted",
          payload: {
            threadId: command.threadId,
            proposedPlan: command.proposedPlan,
          },
        };
      }

      case "thread.turn.diff.complete": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.turn-diff-completed",
          payload: {
            threadId: command.threadId,
            turnId: command.turnId,
            checkpointTurnCount: command.checkpointTurnCount,
            checkpointRef: command.checkpointRef,
            status: command.status,
            files: command.files,
            assistantMessageId: command.assistantMessageId ?? null,
            completedAt: command.completedAt,
            ...(command.preserveLatestTurn ? { preserveLatestTurn: true } : {}),
          },
        };
      }

      case "thread.revert.complete": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.reverted",
          payload: {
            threadId: command.threadId,
            turnCount: command.turnCount,
          },
        };
      }

      case "thread.conversation.rollback.complete": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.conversation-rolled-back",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            numTurns: command.numTurns,
            ...(command.removedTurnIds !== undefined
              ? { removedTurnIds: command.removedTurnIds }
              : {}),
            ...(command.skipAttachmentPrune !== undefined
              ? { skipAttachmentPrune: command.skipAttachmentPrune }
              : {}),
          },
        };
      }

      case "thread.activity.append": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const requestId =
          typeof command.activity.payload === "object" &&
          command.activity.payload !== null &&
          "requestId" in command.activity.payload &&
          typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
            ? ((command.activity.payload as { requestId: string })
                .requestId as OrchestrationEvent["metadata"]["requestId"])
            : undefined;
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            ...(requestId !== undefined ? { metadata: { requestId } } : {}),
          }),
          type: "thread.activity-appended",
          payload: {
            threadId: command.threadId,
            activity: command.activity,
          },
        };
      }

      default: {
        command satisfies never;
        const fallback = command as never as { type: string };
        return yield* new OrchestrationCommandInvariantError({
          commandType: fallback.type,
          detail: `Unknown command type: ${fallback.type}`,
        });
      }
    }
  },
);
