import type { OrchestrationCommand, OrchestrationReadModel } from "@agent-group/contracts";
import { TurnId } from "@agent-group/contracts";
import { resolveTailUserMessageEditTarget } from "@agent-group/shared/conversationEdit";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { requireThread } from "../commandInvariants.ts";
import { type DeciderResult, deriveConversationRollbackTarget, withEventBase } from "./common.ts";

type ThreadHistoryCommand = Extract<
  OrchestrationCommand,
  {
    type:
      | "thread.checkpoint.revert"
      | "thread.conversation.rollback"
      | "thread.message.edit-and-resend"
      | "thread.session.stop"
      | "thread.session.set"
      | "thread.messages.import";
  }
>;

export const decideThreadHistoryCommand = Effect.fn("decideThreadHistoryCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: ThreadHistoryCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<DeciderResult, OrchestrationCommandInvariantError> {
  switch (command.type) {
    case "thread.checkpoint.revert": {
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
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          scope: command.scope ?? "thread",
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.conversation.rollback": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const rollbackTarget = deriveConversationRollbackTarget(thread.messages, command.messageId);
      if (!rollbackTarget || rollbackTarget.role !== "user") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Conversation rollback must target an existing user message.",
        });
      }
      if (command.numTurns <= 0 || rollbackTarget.removedTurnIds.size !== command.numTurns) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Conversation rollback requested ${command.numTurns} turn(s), but target message '${command.messageId}' would remove ${rollbackTarget.removedTurnIds.size} turn(s).`,
        });
      }
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.conversation-rollback-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          numTurns: command.numTurns,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.message.edit-and-resend": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const editTarget = resolveTailUserMessageEditTarget({
        messages: thread.messages,
        messageId: command.messageId,
        activeTurnId:
          thread.session?.status === "running" ? (thread.session.activeTurnId ?? null) : null,
      });
      if (!editTarget.editable) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Only the latest rollbackable user message can be edited and resent (${editTarget.reason}).`,
        });
      }
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-edit-resend-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          text: command.text,
          ...(command.mentions !== undefined ? { mentions: command.mentions } : {}),
          rollbackTurnCount: editTarget.rollbackTurnCount,
          removedTurnIds: editTarget.removedTurnIds.map((turnId) => TurnId.makeUnsafe(turnId)),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.providerOptions !== undefined
            ? { providerOptions: command.providerOptions }
            : {}),
          ...(command.assistantDeliveryMode !== undefined
            ? { assistantDeliveryMode: command.assistantDeliveryMode }
            : {}),
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
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
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
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
          metadata: {},
        }),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
    }

    case "thread.messages.import": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return command.messages.map((message) => ({
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent" as const,
        payload: {
          threadId: command.threadId,
          messageId: message.messageId,
          role: message.role,
          text: message.text,
          ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
          turnId: null,
          streaming: false,
          source: "native" as const,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        },
      }));
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
});
