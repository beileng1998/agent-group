import type { OrchestrationEvent, OrchestrationReadModel } from "@agent-group/contracts";
import { OrchestrationMessage } from "@agent-group/contracts";
import { Effect } from "effect";

import {
  MessageSentPayloadSchema,
  ThreadActivityAppendedPayload,
  ThreadTurnStartRequestedPayload,
} from "../Schemas.ts";
import { resolveStableMessageTurnId } from "../messageTurnId.ts";
import {
  decodeForEvent,
  MAX_THREAD_MESSAGES,
  type ProjectorEffect,
  updateThread,
  upsertThreadActivity,
} from "./common.ts";

export type MessageActivityEvent = Extract<
  OrchestrationEvent,
  {
    type: "thread.turn-start-requested" | "thread.message-sent" | "thread.activity-appended";
  }
>;

export function projectMessageActivityEvent(
  nextBase: OrchestrationReadModel,
  event: MessageActivityEvent,
): ProjectorEffect {
  switch (event.type) {
    case "thread.turn-start-requested":
      return decodeForEvent(
        ThreadTurnStartRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              ...(payload.modelSelection !== undefined
                ? { modelSelection: payload.modelSelection }
                : {}),
              runtimeMode: payload.runtimeMode,
              interactionMode: payload.interactionMode,
              updatedAt: payload.createdAt,
            }),
          };
        }),
      );

    case "thread.message-sent":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          MessageSentPayloadSchema,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const message: OrchestrationMessage = yield* decodeForEvent(
          OrchestrationMessage,
          {
            id: payload.messageId,
            role: payload.role,
            text: payload.text,
            ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
            ...(payload.skills !== undefined ? { skills: payload.skills } : {}),
            ...(payload.mentions !== undefined ? { mentions: payload.mentions } : {}),
            turnId: payload.turnId,
            streaming: payload.streaming,
            source: payload.source,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          },
          event.type,
          "message",
        );

        const existingMessage = thread.messages.find((entry) => entry.id === message.id);
        const messages = existingMessage
          ? thread.messages.map((entry) =>
              entry.id === message.id
                ? {
                    ...entry,
                    text: message.streaming
                      ? `${entry.text}${message.text}`
                      : message.text.length > 0
                        ? message.text
                        : entry.text,
                    streaming: message.streaming,
                    source: message.source,
                    updatedAt: message.updatedAt,
                    turnId: resolveStableMessageTurnId({
                      existingTurnId: entry.turnId,
                      incomingTurnId: message.turnId,
                    }),
                    ...(message.attachments !== undefined
                      ? { attachments: message.attachments }
                      : {}),
                    ...(message.skills !== undefined ? { skills: message.skills } : {}),
                    ...(message.mentions !== undefined ? { mentions: message.mentions } : {}),
                  }
                : entry,
            )
          : [...thread.messages, message];
        const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            messages: cappedMessages,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.activity-appended":
      return decodeForEvent(
        ThreadActivityAppendedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const activities = upsertThreadActivity(thread.activities, payload.activity);

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              activities,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );
  }
}
