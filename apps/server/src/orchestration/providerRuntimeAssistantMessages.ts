import {
  MessageId,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Cache, Effect, Option } from "effect";

import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type { ProviderRuntimeBufferState } from "./providerRuntimeBufferState.ts";
import {
  hasRenderableAssistantText,
  providerCommandId,
  providerTurnKey,
} from "./providerRuntimeIngestionValues.ts";

const MAX_BUFFERED_ASSISTANT_CHARS = 24_000;

export function makeProviderRuntimeAssistantMessages(input: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly state: ProviderRuntimeBufferState;
}) {
  const rememberAssistantMessageId = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(input.state.turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap((existingIds) =>
        Cache.set(
          input.state.turnMessageIdsByTurnKey,
          providerTurnKey(threadId, turnId),
          Option.match(existingIds, {
            onNone: () => new Set([messageId]),
            onSome: (ids) => new Set([...ids, messageId]),
          }),
        ),
      ),
    );

  const forgetAssistantMessageId = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(input.state.turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap((existingIds) =>
        Option.match(existingIds, {
          onNone: () => Effect.void,
          onSome: (ids) => {
            const nextIds = new Set(ids);
            nextIds.delete(messageId);
            return nextIds.size === 0
              ? Cache.invalidate(
                  input.state.turnMessageIdsByTurnKey,
                  providerTurnKey(threadId, turnId),
                )
              : Cache.set(
                  input.state.turnMessageIdsByTurnKey,
                  providerTurnKey(threadId, turnId),
                  nextIds,
                );
          },
        }),
      ),
    );

  const getAssistantMessageIdsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.getOption(input.state.turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.map((ids) => Option.getOrElse(ids, (): Set<MessageId> => new Set<MessageId>())),
    );

  const clearAssistantMessageIdsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.invalidate(input.state.turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));

  const appendBufferedAssistantText = (messageId: MessageId, delta: string) =>
    Cache.getOption(input.state.bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((existingText) =>
        Effect.gen(function* () {
          const nextText = Option.match(existingText, {
            onNone: () => delta,
            onSome: (text) => `${text}${delta}`,
          });
          if (nextText.length <= MAX_BUFFERED_ASSISTANT_CHARS) {
            yield* Cache.set(input.state.bufferedAssistantTextByMessageId, messageId, nextText);
            return "";
          }
          yield* Cache.invalidate(input.state.bufferedAssistantTextByMessageId, messageId);
          return nextText;
        }),
      ),
    );

  const takeBufferedAssistantText = (messageId: MessageId) =>
    Cache.getOption(input.state.bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((text) =>
        Cache.invalidate(input.state.bufferedAssistantTextByMessageId, messageId).pipe(
          Effect.as(Option.getOrElse(text, () => "")),
        ),
      ),
    );

  const clearAssistantMessageState = (messageId: MessageId) =>
    Cache.invalidate(input.state.bufferedAssistantTextByMessageId, messageId);

  const resolveAssistantCompletionMessageId = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly thread: OrchestrationThread;
    readonly turnId?: TurnId;
  }) =>
    Effect.gen(function* () {
      if (params.turnId) {
        const knownIds = yield* getAssistantMessageIdsForTurn(params.thread.id, params.turnId);
        if (params.event.itemId) {
          const eventMessageId = MessageId.makeUnsafe(`assistant:${params.event.itemId}`);
          if (knownIds.has(eventMessageId)) return eventMessageId;
        }
        if (knownIds.size === 1) {
          const [onlyId] = knownIds;
          if (onlyId) return onlyId;
        }
        if (knownIds.size > 1) {
          const preferred = params.thread.messages
            .filter(
              (message) =>
                message.role === "assistant" &&
                message.turnId === params.turnId &&
                knownIds.has(message.id),
            )
            .toSorted((left, right) => {
              if (left.streaming !== right.streaming) return left.streaming ? -1 : 1;
              return (
                right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
              );
            })[0];
          if (preferred) return preferred.id;
        }
        return params.event.itemId
          ? MessageId.makeUnsafe(`assistant:${params.event.itemId}`)
          : MessageId.makeUnsafe(`assistant:${params.turnId}`);
      }
      return params.event.itemId
        ? MessageId.makeUnsafe(`assistant:${params.event.itemId}`)
        : MessageId.makeUnsafe(`assistant:${params.event.eventId}`);
    });

  const flushBufferedAssistantMessageDelta = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
    readonly turnId?: TurnId;
    readonly createdAt: string;
    readonly commandTag: string;
  }) =>
    Effect.gen(function* () {
      const text = yield* takeBufferedAssistantText(params.messageId);
      if (!hasRenderableAssistantText(text)) return false;
      yield* input.orchestrationEngine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: providerCommandId(params.event, params.commandTag),
        threadId: params.threadId,
        messageId: params.messageId,
        delta: text,
        ...(params.turnId ? { turnId: params.turnId } : {}),
        createdAt: params.createdAt,
      });
      return true;
    });

  const flushBufferedAssistantMessagesForTurn = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly createdAt: string;
    readonly commandTag: string;
  }) =>
    Effect.gen(function* () {
      const ids = yield* getAssistantMessageIdsForTurn(params.threadId, params.turnId);
      for (const messageId of ids) {
        yield* flushBufferedAssistantMessageDelta({ ...params, messageId });
      }
    });

  const finalizeAssistantMessage = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
    readonly turnId?: TurnId;
    readonly createdAt: string;
    readonly commandTag: string;
    readonly finalDeltaCommandTag: string;
    readonly fallbackText?: string;
  }) =>
    Effect.gen(function* () {
      const bufferedText = yield* takeBufferedAssistantText(params.messageId);
      const text =
        bufferedText.length > 0
          ? bufferedText
          : (params.fallbackText?.trim().length ?? 0) > 0
            ? params.fallbackText!
            : "";
      if (hasRenderableAssistantText(text)) {
        yield* input.orchestrationEngine.dispatch({
          type: "thread.message.assistant.delta",
          commandId: providerCommandId(params.event, params.finalDeltaCommandTag),
          threadId: params.threadId,
          messageId: params.messageId,
          delta: text,
          ...(params.turnId ? { turnId: params.turnId } : {}),
          createdAt: params.createdAt,
        });
      }
      yield* input.orchestrationEngine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: providerCommandId(params.event, params.commandTag),
        threadId: params.threadId,
        messageId: params.messageId,
        ...(params.turnId ? { turnId: params.turnId } : {}),
        createdAt: params.createdAt,
      });
      yield* clearAssistantMessageState(params.messageId);
    });

  const finalizeBufferedAssistantMessagesForTurn = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly createdAt: string;
    readonly commandTag: string;
    readonly finalDeltaCommandTag: string;
  }) =>
    Effect.gen(function* () {
      const ids = yield* getAssistantMessageIdsForTurn(params.threadId, params.turnId);
      yield* Effect.forEach(
        ids,
        (messageId) => finalizeAssistantMessage({ ...params, messageId }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* clearAssistantMessageIdsForTurn(params.threadId, params.turnId);
    });

  return {
    rememberAssistantMessageId,
    forgetAssistantMessageId,
    getAssistantMessageIdsForTurn,
    clearAssistantMessageIdsForTurn,
    appendBufferedAssistantText,
    clearAssistantMessageState,
    resolveAssistantCompletionMessageId,
    flushBufferedAssistantMessagesForTurn,
    finalizeAssistantMessage,
    finalizeBufferedAssistantMessagesForTurn,
  };
}
