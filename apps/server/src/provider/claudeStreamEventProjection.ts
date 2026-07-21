import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderRuntimeEvent } from "@agent-group/contracts";
import { Effect } from "effect";

import type {
  ClaudeAssistantTextBlockState,
  ClaudeSessionContext,
  ClaudeToolInFlight,
} from "./claudeAdapterRuntime.ts";
import { asCanonicalTurnId, asRuntimeItemId } from "./claudeAdapterProtocol.ts";
import {
  extractContentBlockText,
  nativeProviderRefs,
  streamKindFromDeltaType,
  toolInputFingerprint,
  tryParseJsonRecord,
} from "./claudeSdkMessage.ts";
import {
  classifyToolItemType,
  isClientSurfacedClaudeTool,
  summarizeToolRequest,
  titleForTool,
  toolLifecycleEventData,
} from "./claudeToolMapping.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeStreamEventProjection(input: {
  readonly ensureAssistantTextBlock: (
    context: ClaudeSessionContext,
    blockIndex: number,
    options?: { readonly fallbackText?: string; readonly streamClosed?: boolean },
  ) => Effect.Effect<
    { readonly blockIndex: number; readonly block: ClaudeAssistantTextBlockState } | undefined
  >;
  readonly completeAssistantTextBlock: (
    context: ClaudeSessionContext,
    block: ClaudeAssistantTextBlockState,
    options?: {
      readonly force?: boolean;
      readonly rawMethod?: string;
      readonly rawPayload?: unknown;
    },
  ) => Effect.Effect<void>;
  readonly emitTodoTasksUpdated: (
    context: ClaudeSessionContext,
    taskInput: {
      readonly toolInput: Record<string, unknown>;
      readonly toolUseId?: string | undefined;
      readonly rawMethod: string;
      readonly rawPayload: unknown;
    },
  ) => Effect.Effect<void>;
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}) {
  return (context: ClaudeSessionContext, message: SDKMessage): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (message.type !== "stream_event") {
        return;
      }

      const { event } = message;
      if (event.type === "content_block_delta") {
        if (
          (event.delta.type === "text_delta" || event.delta.type === "thinking_delta") &&
          context.turnState
        ) {
          const deltaText =
            event.delta.type === "text_delta"
              ? event.delta.text
              : typeof event.delta.thinking === "string"
                ? event.delta.thinking
                : "";
          if (deltaText.length === 0) {
            return;
          }
          const streamKind = streamKindFromDeltaType(event.delta.type);
          const assistantBlockEntry =
            event.delta.type === "text_delta"
              ? yield* input.ensureAssistantTextBlock(context, event.index)
              : context.turnState.assistantTextBlocks.get(event.index)
                ? {
                    blockIndex: event.index,
                    block: context.turnState.assistantTextBlocks.get(event.index)!,
                  }
                : undefined;
          if (assistantBlockEntry?.block && event.delta.type === "text_delta") {
            assistantBlockEntry.block.emittedTextDelta = true;
          }
          const stamp = yield* input.makeEventStamp();
          yield* input.offerRuntimeEvent({
            type: "content.delta",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.session.threadId,
            turnId: context.turnState.turnId,
            ...(assistantBlockEntry?.block
              ? { itemId: asRuntimeItemId(assistantBlockEntry.block.itemId) }
              : {}),
            payload: { streamKind, delta: deltaText },
            providerRefs: nativeProviderRefs(context),
            raw: {
              source: "claude.sdk.message",
              method: "claude/stream_event/content_block_delta",
              payload: message,
            },
          });
          return;
        }

        if (event.delta.type === "input_json_delta") {
          const tool = context.inFlightTools.get(event.index);
          if (!tool || typeof event.delta.partial_json !== "string") {
            return;
          }

          const partialInputJson = tool.partialInputJson + event.delta.partial_json;
          const parsedInput = tryParseJsonRecord(partialInputJson);
          const detail = parsedInput
            ? summarizeToolRequest(tool.toolName, parsedInput)
            : tool.detail;
          let nextTool: ClaudeToolInFlight = {
            ...tool,
            partialInputJson,
            ...(parsedInput ? { input: parsedInput } : {}),
            ...(detail ? { detail } : {}),
          };
          const nextFingerprint =
            parsedInput && Object.keys(parsedInput).length > 0
              ? toolInputFingerprint(parsedInput)
              : undefined;
          context.inFlightTools.set(event.index, nextTool);
          if (
            !parsedInput ||
            !nextFingerprint ||
            tool.lastEmittedInputFingerprint === nextFingerprint
          ) {
            return;
          }

          nextTool = { ...nextTool, lastEmittedInputFingerprint: nextFingerprint };
          context.inFlightTools.set(event.index, nextTool);
          const stamp = yield* input.makeEventStamp();
          yield* input.offerRuntimeEvent({
            type: "item.updated",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.session.threadId,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            itemId: asRuntimeItemId(nextTool.itemId),
            payload: {
              itemType: nextTool.itemType,
              status: "inProgress",
              title: nextTool.title,
              ...(nextTool.detail ? { detail: nextTool.detail } : {}),
              data: toolLifecycleEventData(nextTool),
            },
            providerRefs: nativeProviderRefs(context, {
              providerItemId: nextTool.itemId,
            }),
            raw: {
              source: "claude.sdk.message",
              method: "claude/stream_event/content_block_delta/input_json_delta",
              payload: message,
            },
          });
          if (nextTool.toolName === "TodoWrite") {
            yield* input.emitTodoTasksUpdated(context, {
              toolInput: nextTool.input,
              toolUseId: nextTool.itemId,
              rawMethod: "claude/stream_event/content_block_delta/input_json_delta",
              rawPayload: message,
            });
          }
        }
        return;
      }

      if (event.type === "content_block_start") {
        const { index, content_block: block } = event;
        if (block.type === "text") {
          yield* input.ensureAssistantTextBlock(context, index, {
            fallbackText: extractContentBlockText(block),
          });
          return;
        }
        if (
          block.type !== "tool_use" &&
          block.type !== "server_tool_use" &&
          block.type !== "mcp_tool_use"
        ) {
          return;
        }
        const toolName = block.name;
        if (isClientSurfacedClaudeTool(toolName)) {
          return;
        }
        const itemType = classifyToolItemType(toolName);
        const toolInput =
          typeof block.input === "object" && block.input !== null
            ? (block.input as Record<string, unknown>)
            : {};
        const itemId = block.id;
        const detail = summarizeToolRequest(toolName, toolInput);
        const inputFingerprint =
          Object.keys(toolInput).length > 0 ? toolInputFingerprint(toolInput) : undefined;
        const tool: ClaudeToolInFlight = {
          itemId,
          itemType,
          toolName,
          title: titleForTool(itemType),
          detail,
          input: toolInput,
          partialInputJson: "",
          ...(inputFingerprint ? { lastEmittedInputFingerprint: inputFingerprint } : {}),
        };
        context.inFlightTools.set(index, tool);
        if (toolName === "Task" || toolName === "Agent") {
          context.subagentRoutes.registerToolUse(itemId);
        }

        const stamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "item.started",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            itemType: tool.itemType,
            status: "inProgress",
            title: tool.title,
            ...(tool.detail ? { detail: tool.detail } : {}),
            data: toolLifecycleEventData(tool),
          },
          providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/stream_event/content_block_start",
            payload: message,
          },
        });
        if (toolName === "TodoWrite") {
          yield* input.emitTodoTasksUpdated(context, {
            toolInput,
            toolUseId: tool.itemId,
            rawMethod: "claude/stream_event/content_block_start",
            rawPayload: message,
          });
        }
        return;
      }

      if (event.type === "content_block_stop") {
        const assistantBlock = context.turnState?.assistantTextBlocks.get(event.index);
        if (assistantBlock) {
          assistantBlock.streamClosed = true;
          yield* input.completeAssistantTextBlock(context, assistantBlock, {
            rawMethod: "claude/stream_event/content_block_stop",
            rawPayload: message,
          });
        }
      }
    });
}
