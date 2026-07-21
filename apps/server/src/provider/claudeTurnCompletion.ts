import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  ProviderRuntimeEvent,
  ProviderRuntimeTurnStatus,
  ThreadTokenUsageSnapshot,
} from "@agent-group/contracts";
import { Effect } from "effect";

import type {
  ClaudeAssistantTextBlockState,
  ClaudeSessionContext,
} from "./claudeAdapterRuntime.ts";
import { asRuntimeItemId } from "./claudeAdapterProtocol.ts";
import { nativeProviderRefs } from "./claudeSdkMessage.ts";
import {
  claudeEffectiveContextBudget,
  maxClaudeContextWindowFromModelUsage,
  mergeClaudeTokenUsageSnapshot,
  normalizeClaudeTokenUsage,
  resolveEffectiveClaudeContextWindow,
} from "./claudeTokenUsage.ts";
import { toolLifecycleEventData } from "./claudeToolMapping.ts";
import { positiveFiniteNumber } from "./tokenUsage.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeTurnCompletion(input: {
  readonly readContextUsage: (
    context: ClaudeSessionContext,
  ) => Effect.Effect<
    import("@anthropic-ai/claude-agent-sdk").SDKControlGetContextUsageResponse | undefined
  >;
  readonly snapshotContextUsage: (
    usage: import("@anthropic-ai/claude-agent-sdk").SDKControlGetContextUsageResponse,
    totalProcessedTokens?: number,
  ) => ThreadTokenUsageSnapshot;
  readonly completeAssistantTextBlock: (
    context: ClaudeSessionContext,
    block: ClaudeAssistantTextBlockState,
    options?: {
      readonly force?: boolean;
      readonly rawMethod?: string;
      readonly rawPayload?: unknown;
    },
  ) => Effect.Effect<void>;
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly nowIso: Effect.Effect<string>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly updateResumeCursor: (context: ClaudeSessionContext) => Effect.Effect<void>;
}) {
  return (
    context: ClaudeSessionContext,
    status: ProviderRuntimeTurnStatus,
    errorMessage?: string,
    result?: SDKResultMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const liveContextUsage = yield* input.readContextUsage(context);
      const resultContextWindow = maxClaudeContextWindowFromModelUsage(result?.modelUsage);
      const liveRawContextWindow = positiveFiniteNumber(liveContextUsage?.rawMaxTokens);
      const effectiveContextWindow = resolveEffectiveClaudeContextWindow({
        reportedContextWindow: liveRawContextWindow ?? resultContextWindow,
        lastKnownContextWindow: context.lastKnownContextWindow,
      });
      if (effectiveContextWindow !== undefined) {
        context.lastKnownContextWindow = effectiveContextWindow;
      }
      const liveAutoCompactThreshold = positiveFiniteNumber(liveContextUsage?.autoCompactThreshold);
      if (liveAutoCompactThreshold !== undefined) {
        context.lastKnownAutoCompactThreshold = liveAutoCompactThreshold;
      }

      const accumulatedSnapshot = normalizeClaudeTokenUsage(
        result?.usage,
        claudeEffectiveContextBudget(context),
      );
      const totalProcessedTokens =
        accumulatedSnapshot?.totalProcessedTokens ?? accumulatedSnapshot?.usedTokens;
      const liveSnapshot = liveContextUsage
        ? input.snapshotContextUsage(liveContextUsage, totalProcessedTokens)
        : undefined;
      const lastGoodUsage = liveSnapshot ?? context.lastKnownTokenUsage;
      const maxTokens = claudeEffectiveContextBudget(context);
      const usageSnapshot: ThreadTokenUsageSnapshot | undefined = lastGoodUsage
        ? mergeClaudeTokenUsageSnapshot(lastGoodUsage, accumulatedSnapshot, maxTokens)
        : accumulatedSnapshot;

      const turnState = context.turnState;
      if (!turnState) {
        if (usageSnapshot) {
          const usageStamp = yield* input.makeEventStamp();
          yield* input.offerRuntimeEvent({
            type: "thread.token-usage.updated",
            eventId: usageStamp.eventId,
            provider: PROVIDER,
            createdAt: usageStamp.createdAt,
            threadId: context.session.threadId,
            payload: { usage: usageSnapshot },
            providerRefs: {},
          });
        }

        const stamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "turn.completed",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          payload: {
            state: status,
            ...(result?.stop_reason !== undefined ? { stopReason: result.stop_reason } : {}),
            ...(result?.usage ? { usage: result.usage } : {}),
            ...(result?.modelUsage ? { modelUsage: result.modelUsage } : {}),
            ...(typeof result?.total_cost_usd === "number"
              ? { totalCostUsd: result.total_cost_usd }
              : {}),
            ...(errorMessage ? { errorMessage } : {}),
          },
          providerRefs: {},
        });
        return;
      }

      for (const [index, tool] of context.inFlightTools.entries()) {
        const toolStamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "item.completed",
          eventId: toolStamp.eventId,
          provider: PROVIDER,
          createdAt: toolStamp.createdAt,
          threadId: context.session.threadId,
          turnId: turnState.turnId,
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            itemType: tool.itemType,
            status: status === "completed" ? "completed" : "failed",
            title: tool.title,
            ...(tool.detail ? { detail: tool.detail } : {}),
            data: toolLifecycleEventData(tool),
          },
          providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/result",
            payload: result ?? { status },
          },
        });
        if (tool.itemType === "file_change") {
          context.turnState = { ...turnState, sawFileChange: true };
        }
        context.inFlightTools.delete(index);
      }
      context.inFlightTools.clear();

      for (const block of turnState.assistantTextBlockOrder) {
        yield* input.completeAssistantTextBlock(context, block, {
          force: true,
          rawMethod: "claude/result",
          rawPayload: result ?? { status },
        });
      }

      context.turns.push({
        id: turnState.turnId,
        items: [...turnState.items],
      });

      if (usageSnapshot) {
        const usageStamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "thread.token-usage.updated",
          eventId: usageStamp.eventId,
          provider: PROVIDER,
          createdAt: usageStamp.createdAt,
          threadId: context.session.threadId,
          turnId: turnState.turnId,
          payload: { usage: usageSnapshot },
          providerRefs: nativeProviderRefs(context),
        });
      }

      if (status === "completed" && turnState.sawFileChange) {
        const diffStamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent({
          type: "turn.diff.updated",
          eventId: diffStamp.eventId,
          provider: PROVIDER,
          createdAt: diffStamp.createdAt,
          threadId: context.session.threadId,
          turnId: turnState.turnId,
          payload: { unifiedDiff: "" },
          providerRefs: nativeProviderRefs(context),
          raw: {
            source: "claude.sdk.message",
            method: "claude/result",
            payload: result ?? { status },
          },
        });
      }

      const stamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "turn.completed",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        payload: {
          state: status,
          ...(result?.stop_reason !== undefined ? { stopReason: result.stop_reason } : {}),
          ...(result?.usage ? { usage: result.usage } : {}),
          ...(result?.modelUsage ? { modelUsage: result.modelUsage } : {}),
          ...(typeof result?.total_cost_usd === "number"
            ? { totalCostUsd: result.total_cost_usd }
            : {}),
          ...(errorMessage ? { errorMessage } : {}),
        },
        providerRefs: nativeProviderRefs(context),
      });

      const updatedAt = yield* input.nowIso;
      if (context.interruptRequestedTurnId === turnState.turnId) {
        context.interruptRequestedTurnId = undefined;
      }
      context.lastInteractionMode = turnState.interactionMode;
      context.turnState = undefined;
      context.session = {
        ...context.session,
        status: "ready",
        activeTurnId: undefined,
        updatedAt,
        ...(status === "failed" && errorMessage ? { lastError: errorMessage } : {}),
      };
      yield* input.updateResumeCursor(context);
    });
}
