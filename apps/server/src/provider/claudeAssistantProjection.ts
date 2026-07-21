import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderRuntimeEvent } from "@agent-group/contracts";
import { Effect, Random } from "effect";

import type {
  ClaudeAssistantTextBlockState,
  ClaudeSessionContext,
} from "./claudeAdapterRuntime.ts";
import { asRuntimeItemId } from "./claudeAdapterProtocol.ts";
import { extractAssistantTextBlocks, nativeProviderRefs } from "./claudeSdkMessage.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeAssistantProjection(input: {
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}) {
  const ensureTextBlock = (
    context: ClaudeSessionContext,
    blockIndex: number,
    options?: {
      readonly fallbackText?: string;
      readonly streamClosed?: boolean;
    },
  ): Effect.Effect<
    | {
        readonly blockIndex: number;
        readonly block: ClaudeAssistantTextBlockState;
      }
    | undefined
  > =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      if (!turnState) {
        return undefined;
      }

      const existing = turnState.assistantTextBlocks.get(blockIndex);
      if (existing && !existing.completionEmitted) {
        if (existing.fallbackText.length === 0 && options?.fallbackText) {
          existing.fallbackText = options.fallbackText;
        }
        if (options?.streamClosed) {
          existing.streamClosed = true;
        }
        return { blockIndex, block: existing };
      }

      const block: ClaudeAssistantTextBlockState = {
        itemId: yield* Random.nextUUIDv4,
        blockIndex,
        emittedTextDelta: false,
        fallbackText: options?.fallbackText ?? "",
        streamClosed: options?.streamClosed ?? false,
        completionEmitted: false,
      };
      turnState.assistantTextBlocks.set(blockIndex, block);
      turnState.assistantTextBlockOrder.push(block);
      return { blockIndex, block };
    });

  const createSyntheticTextBlock = (
    context: ClaudeSessionContext,
    fallbackText: string,
  ): Effect.Effect<
    | {
        readonly blockIndex: number;
        readonly block: ClaudeAssistantTextBlockState;
      }
    | undefined
  > =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      if (!turnState) {
        return undefined;
      }
      const blockIndex = turnState.nextSyntheticAssistantBlockIndex;
      turnState.nextSyntheticAssistantBlockIndex -= 1;
      return yield* ensureTextBlock(context, blockIndex, {
        fallbackText,
        streamClosed: true,
      });
    });

  const completeTextBlock = (
    context: ClaudeSessionContext,
    block: ClaudeAssistantTextBlockState,
    options?: {
      readonly force?: boolean;
      readonly rawMethod?: string;
      readonly rawPayload?: unknown;
    },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      if (!turnState || block.completionEmitted) {
        return;
      }
      if (!options?.force && !block.streamClosed) {
        return;
      }

      if (!block.emittedTextDelta && block.fallbackText.length > 0) {
        const deltaStamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "content.delta",
          eventId: deltaStamp.eventId,
          provider: PROVIDER,
          createdAt: deltaStamp.createdAt,
          threadId: context.session.threadId,
          turnId: turnState.turnId,
          itemId: asRuntimeItemId(block.itemId),
          payload: {
            streamKind: "assistant_text",
            delta: block.fallbackText,
          },
          providerRefs: nativeProviderRefs(context),
          ...(options?.rawMethod || options?.rawPayload
            ? {
                raw: {
                  source: "claude.sdk.message" as const,
                  ...(options.rawMethod ? { method: options.rawMethod } : {}),
                  payload: options?.rawPayload,
                },
              }
            : {}),
        });
      }

      block.completionEmitted = true;
      if (turnState.assistantTextBlocks.get(block.blockIndex) === block) {
        turnState.assistantTextBlocks.delete(block.blockIndex);
      }

      const stamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "item.completed",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        itemId: asRuntimeItemId(block.itemId),
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        payload: {
          itemType: "assistant_message",
          status: "completed",
          title: "Assistant message",
          ...(block.fallbackText.length > 0 ? { detail: block.fallbackText } : {}),
        },
        providerRefs: nativeProviderRefs(context),
        ...(options?.rawMethod || options?.rawPayload
          ? {
              raw: {
                source: "claude.sdk.message" as const,
                ...(options.rawMethod ? { method: options.rawMethod } : {}),
                payload: options?.rawPayload,
              },
            }
          : {}),
      });
    });

  const backfillFromSnapshot = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      if (!turnState) {
        return;
      }

      const snapshotTextBlocks = extractAssistantTextBlocks(message);
      if (snapshotTextBlocks.length === 0) {
        return;
      }

      const orderedBlocks = turnState.assistantTextBlockOrder.map((block) => ({
        blockIndex: block.blockIndex,
        block,
      }));

      for (const [position, text] of snapshotTextBlocks.entries()) {
        const existingEntry = orderedBlocks[position];
        const entry =
          existingEntry ??
          (yield* createSyntheticTextBlock(context, text).pipe(
            Effect.map((created) => {
              if (!created) return undefined;
              orderedBlocks.push(created);
              return created;
            }),
          ));
        if (!entry) {
          continue;
        }
        if (entry.block.fallbackText.length === 0) {
          entry.block.fallbackText = text;
        }
        if (entry.block.streamClosed && !entry.block.completionEmitted) {
          yield* completeTextBlock(context, entry.block, {
            rawMethod: "claude/assistant",
            rawPayload: message,
          });
        }
      }
    });

  return {
    backfillFromSnapshot,
    completeTextBlock,
    createSyntheticTextBlock,
    ensureTextBlock,
  };
}
