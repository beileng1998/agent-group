import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderRuntimeEvent } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ClaudeSessionContext } from "./claudeAdapterRuntime.ts";
import { asCanonicalTurnId, asRuntimeItemId } from "./claudeAdapterProtocol.ts";
import {
  nativeProviderRefs,
  toolResultBlocksFromUserMessage,
  toolResultStreamKind,
} from "./claudeSdkMessage.ts";
import { applyClaudeTaskToolResult } from "./claudeTaskTracker.ts";
import { toolLifecycleEventData } from "./claudeToolMapping.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeUserMessageProjection(input: {
  readonly emitTrackedTasksUpdated: (
    context: ClaudeSessionContext,
    taskInput: { readonly toolUseId?: string; readonly rawPayload: unknown },
  ) => Effect.Effect<void>;
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly updateResumeCursor: (context: ClaudeSessionContext) => Effect.Effect<void>;
}) {
  return (context: ClaudeSessionContext, message: SDKMessage): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (message.type !== "user") {
        return;
      }
      if (context.turnState) {
        context.turnState.items.push(message.message);
      }

      for (const toolResult of toolResultBlocksFromUserMessage(message)) {
        const toolEntry = Array.from(context.inFlightTools.entries()).find(
          ([, tool]) => tool.itemId === toolResult.toolUseId,
        );
        if (!toolEntry) {
          continue;
        }

        const [index, tool] = toolEntry;
        const itemStatus = toolResult.isError ? "failed" : "completed";
        const settledStatus =
          tool.toolName === "Task" || tool.toolName === "Agent"
            ? context.subagentRoutes.settledStatus({ toolUseId: tool.itemId })
            : undefined;
        const toolData = toolLifecycleEventData(tool, {
          result: toolResult.block,
          ...(settledStatus === "stopped"
            ? { agentStates: { [tool.itemId]: { status: "stopped" as const } } }
            : {}),
        });

        const updatedStamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "item.updated",
          eventId: updatedStamp.eventId,
          provider: PROVIDER,
          createdAt: updatedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            itemType: tool.itemType,
            status: toolResult.isError ? "failed" : "inProgress",
            title: tool.title,
            ...(tool.detail ? { detail: tool.detail } : {}),
            data: toolData,
          },
          providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/user",
            payload: message,
          },
        });

        const streamKind = toolResultStreamKind(tool.itemType);
        if (streamKind && toolResult.text.length > 0 && context.turnState) {
          const deltaStamp = yield* input.makeEventStamp();
          yield* input.offerRuntimeEvent({
            type: "content.delta",
            eventId: deltaStamp.eventId,
            provider: PROVIDER,
            createdAt: deltaStamp.createdAt,
            threadId: context.session.threadId,
            turnId: context.turnState.turnId,
            itemId: asRuntimeItemId(tool.itemId),
            payload: { streamKind, delta: toolResult.text },
            providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
            raw: {
              source: "claude.sdk.message",
              method: "claude/user",
              payload: message,
            },
          });
        }

        if (
          applyClaudeTaskToolResult(
            context.trackedTasks,
            tool,
            toolResult.block,
            toolResult.structuredResult,
            toolResult.isError,
          )
        ) {
          yield* input.updateResumeCursor(context);
          yield* input.emitTrackedTasksUpdated(context, {
            toolUseId: tool.itemId,
            rawPayload: message,
          });
        }

        const completedStamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "item.completed",
          eventId: completedStamp.eventId,
          provider: PROVIDER,
          createdAt: completedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            itemType: tool.itemType,
            status: itemStatus,
            title: tool.title,
            ...(tool.detail ? { detail: tool.detail } : {}),
            data: toolData,
          },
          providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/user",
            payload: message,
          },
        });

        if (tool.itemType === "file_change" && context.turnState) {
          context.turnState = { ...context.turnState, sawFileChange: true };
        }
        context.inFlightTools.delete(index);
      }
    });
}
