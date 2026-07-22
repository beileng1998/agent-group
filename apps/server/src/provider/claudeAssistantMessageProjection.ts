import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderRuntimeEvent, ProviderRuntimeTurnStatus } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ClaudeSessionContext } from "./claudeAdapterRuntime.ts";
import { hasPendingUserInterrupt } from "./claudeAdapterErrors.ts";
import { asCanonicalTurnId } from "./claudeAdapterProtocol.ts";
import type { ClaudeProposedPlanCapture } from "./claudePermissionBridge.ts";
import {
  extractExitPlanModePlan,
  extractTextContent,
  isClaudeTaskNotificationResult,
  nativeProviderRefs,
  normalizeClaudeUserVisibleErrorMessage,
  turnStatusFromResult,
} from "./claudeSdkMessage.ts";
import { claudeEffectiveContextBudget, normalizeClaudeTokenUsage } from "./claudeTokenUsage.ts";
import { extractProposedPlanMarkdown } from "./planMode.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeAssistantMessageProjection(input: {
  readonly backfillAssistantTextBlocksFromSnapshot: (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) => Effect.Effect<void>;
  readonly completeTurn: (
    context: ClaudeSessionContext,
    status: ProviderRuntimeTurnStatus,
    errorMessage?: string,
    result?: SDKResultMessage,
  ) => Effect.Effect<void>;
  readonly emitProposedPlanCompleted: (
    context: ClaudeSessionContext,
    capture: ClaudeProposedPlanCapture,
  ) => Effect.Effect<void>;
  readonly emitRuntimeError: (
    context: ClaudeSessionContext,
    message: string,
    cause?: unknown,
  ) => Effect.Effect<void>;
  readonly ensureSyntheticTurn: (context: ClaudeSessionContext) => Effect.Effect<void>;
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly maybeEmitContextUsageWarning: (
    context: ClaudeSessionContext,
    rawUsage: Record<string, unknown>,
  ) => Effect.Effect<void>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly updateResumeCursor: (context: ClaudeSessionContext) => Effect.Effect<void>;
}) {
  const handleAssistantMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (message.type !== "assistant") {
        return;
      }

      yield* input.ensureSyntheticTurn(context);
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") {
            continue;
          }
          const toolUse = block as {
            type?: unknown;
            id?: unknown;
            name?: unknown;
            input?: unknown;
          };
          if (toolUse.type !== "tool_use" || toolUse.name !== "ExitPlanMode") {
            continue;
          }
          const planMarkdown = extractExitPlanModePlan(toolUse.input);
          if (planMarkdown) {
            yield* input.emitProposedPlanCompleted(context, {
              planMarkdown,
              toolUseId: typeof toolUse.id === "string" ? toolUse.id : undefined,
              rawSource: "claude.sdk.message",
              rawMethod: "claude/assistant",
              rawPayload: message,
            });
          }
        }

        const taggedPlanMarkdown =
          context.turnState?.interactionMode === "plan"
            ? extractProposedPlanMarkdown(extractTextContent(content))
            : undefined;
        if (taggedPlanMarkdown) {
          yield* input.emitProposedPlanCompleted(context, {
            planMarkdown: taggedPlanMarkdown,
            rawSource: "claude.sdk.message",
            rawMethod: "claude/assistant/proposed-plan-block",
            rawPayload: message,
          });
        }
      }

      if (context.turnState) {
        context.turnState.items.push(message.message);
        yield* input.backfillAssistantTextBlocksFromSnapshot(context, message);
      }

      const perCallUsage = (message.message as { usage?: unknown } | undefined)?.usage;
      if (perCallUsage) {
        yield* input.maybeEmitContextUsageWarning(context, perCallUsage as Record<string, unknown>);
        const normalizedUsage = normalizeClaudeTokenUsage(
          perCallUsage as Record<string, unknown>,
          claudeEffectiveContextBudget(context),
        );
        if (normalizedUsage) {
          context.lastKnownTokenUsage = normalizedUsage;
          const usageStamp = yield* input.makeEventStamp();
          yield* input.offerRuntimeEvent({
            type: "thread.token-usage.updated",
            eventId: usageStamp.eventId,
            provider: PROVIDER,
            createdAt: usageStamp.createdAt,
            threadId: context.session.threadId,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            payload: { usage: normalizedUsage },
            providerRefs: nativeProviderRefs(context),
            raw: {
              source: "claude.sdk.message",
              method: "claude/assistant-usage",
              payload: perCallUsage,
            },
          });
        }
      }

      context.lastAssistantUuid = message.uuid;
      yield* input.updateResumeCursor(context);
    });

  const handleResultMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (message.type !== "result") {
        return;
      }
      // Resumed SDK sessions can drain background task notifications while a user Turn is active.
      // Their result settles the notification, not the overlapping user Turn.
      if (isClaudeTaskNotificationResult(message)) {
        return;
      }
      const status =
        hasPendingUserInterrupt(context) && message.subtype === "error_during_execution"
          ? "interrupted"
          : turnStatusFromResult(message);
      const errorMessage =
        message.subtype === "success"
          ? undefined
          : normalizeClaudeUserVisibleErrorMessage(message.errors[0], status);
      if (status === "failed") {
        yield* input.emitRuntimeError(context, errorMessage ?? "Claude turn failed.");
      }
      yield* input.completeTurn(context, status, errorMessage, message);
    });

  return { handleAssistantMessage, handleResultMessage };
}
