import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { TurnId, type ProviderRuntimeEvent } from "@agent-group/contracts";
import { Effect, Random } from "effect";

import type { ClaudeSessionContext, ClaudeSubagentRun } from "./claudeAdapterRuntime.ts";
import { asCanonicalTurnId } from "./claudeAdapterProtocol.ts";
import type { ClaudeProposedPlanCapture } from "./claudePermissionBridge.ts";
import { exitPlanCaptureKey, nativeProviderRefs, sdkNativeMethod } from "./claudeSdkMessage.ts";
import type { ClaudeSubagentRouteLookup } from "./claudeSubagentRouting.ts";
import { claudeEffectiveContextBudget, normalizeClaudeTokenUsage } from "./claudeTokenUsage.ts";
import { claudeTrackedTasksPayload, normalizeClaudeTodoTasks } from "./claudeTaskTracker.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeTurnActivity(input: {
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly nowIso: Effect.Effect<string>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly subagentRunForTask: (
    context: ClaudeSessionContext,
    lookup: ClaudeSubagentRouteLookup,
    options?: { readonly includeSettled?: boolean },
  ) => ClaudeSubagentRun | undefined;
}) {
  const emitProposedPlanCompleted = (
    context: ClaudeSessionContext,
    capture: ClaudeProposedPlanCapture,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      const planMarkdown = capture.planMarkdown.trim();
      if (!turnState || planMarkdown.length === 0) {
        return;
      }

      const captureKey = exitPlanCaptureKey({
        toolUseId: capture.toolUseId,
        planMarkdown,
      });
      if (turnState.capturedProposedPlanKeys.has(captureKey)) {
        return;
      }
      turnState.capturedProposedPlanKeys.add(captureKey);

      const stamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "turn.proposed.completed",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        payload: { planMarkdown },
        providerRefs: nativeProviderRefs(context, { providerItemId: capture.toolUseId }),
        raw: {
          source: capture.rawSource,
          method: capture.rawMethod,
          payload: capture.rawPayload,
        },
      });
    });

  const emitTodoTasksUpdated = (
    context: ClaudeSessionContext,
    taskInput: {
      readonly toolInput: Record<string, unknown>;
      readonly toolUseId?: string | undefined;
      readonly rawMethod: string;
      readonly rawPayload: unknown;
    },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      const tasksPayload = normalizeClaudeTodoTasks(taskInput.toolInput);
      if (!turnState || !tasksPayload) {
        return;
      }
      const stamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "turn.tasks.updated",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        payload: tasksPayload,
        providerRefs: nativeProviderRefs(context, {
          providerItemId: taskInput.toolUseId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: taskInput.rawMethod,
          payload: taskInput.rawPayload,
        },
      });
    });

  const emitTrackedTasksUpdated = (
    context: ClaudeSessionContext,
    taskInput: {
      readonly toolUseId?: string | undefined;
      readonly rawPayload: unknown;
    },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      if (!turnState) {
        return;
      }
      const stamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "turn.tasks.updated",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        payload: claudeTrackedTasksPayload(context.trackedTasks),
        providerRefs: nativeProviderRefs(context, {
          providerItemId: taskInput.toolUseId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/user/task-result",
          payload: taskInput.rawPayload,
        },
      });
    });

  const ensureSyntheticTurn = (context: ClaudeSessionContext): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (context.turnState) {
        return;
      }
      const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
      const startedAt = yield* input.nowIso;
      context.turnState = {
        turnId,
        startedAt,
        interactionMode: "default",
        items: [],
        assistantTextBlocks: new Map(),
        assistantTextBlockOrder: [],
        capturedProposedPlanKeys: new Set(),
        sawFileChange: false,
        nextSyntheticAssistantBlockIndex: -1,
      };
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        updatedAt: startedAt,
      };
      const stamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "turn.started",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        turnId,
        payload: {},
        providerRefs: {
          ...nativeProviderRefs(context),
          providerTurnId: turnId,
        },
        raw: {
          source: "claude.sdk.message",
          method: "claude/synthetic-turn-start",
          payload: {},
        },
      });
    });

  const emitTaskUsageSnapshot = (
    context: ClaudeSessionContext,
    message: Extract<SDKMessage, { subtype: "task_progress" | "task_notification" }>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (!message.usage) {
        return;
      }
      const target =
        input.subagentRunForTask(
          context,
          { toolUseId: message.tool_use_id, taskId: message.task_id },
          { includeSettled: true },
        )?.context ?? context;
      const normalizedUsage = normalizeClaudeTokenUsage(
        message.usage,
        claudeEffectiveContextBudget(target),
      );
      if (!normalizedUsage) {
        return;
      }
      target.lastKnownTokenUsage = normalizedUsage;
      const stamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "thread.token-usage.updated",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: target.session.threadId,
        ...(target.turnState ? { turnId: asCanonicalTurnId(target.turnState.turnId) } : {}),
        payload: { usage: normalizedUsage },
        providerRefs: nativeProviderRefs(target),
        raw: {
          source: "claude.sdk.message",
          method: sdkNativeMethod(message),
          messageType: `${message.type}:${message.subtype}`,
          payload: message,
        },
      });
    });

  return {
    emitProposedPlanCompleted,
    emitTaskUsageSnapshot,
    emitTodoTasksUpdated,
    emitTrackedTasksUpdated,
    ensureSyntheticTurn,
  };
}
