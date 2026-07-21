import { TurnId, type ModelCapabilities, type ProviderRuntimeEvent } from "@agent-group/contracts";
import { resolveApiModelId } from "@agent-group/shared/model";
import { Deferred, Effect, FileSystem, Queue, Random } from "effect";

import type { ClaudeSessionContext, ClaudeTurnState } from "./claudeAdapterRuntime.ts";
import { toRequestError } from "./claudeAdapterErrors.ts";
import { buildUserMessageEffect } from "./claudePromptInput.ts";
import { hasOnlyCompletedClaudeTasks, hasUnfinishedClaudeTasks } from "./claudeTaskTracker.ts";
import {
  resolveClaudeApiModelIdContextWindowMaxTokens,
  resolveSelectedClaudeAutoCompactWindow,
  stripClaudeContextWindowSuffix,
} from "./claudeTokenUsage.ts";
import { ProviderAdapterRequestError, type ProviderAdapterError } from "./Errors.ts";
import type { ClaudeAdapterShape } from "./Services/ClaudeAdapter.ts";
import { runTurnIdleWatchdog } from "./turnIdleWatchdog.ts";

const PROVIDER = "claudeAgent" as const;
const CLAUDE_TURN_WATCHDOG_MAX_INTERVAL_MS = 15_000;

export function makeClaudeTurnController(input: {
  readonly attachmentsDir: string;
  readonly completeTurn: (
    context: ClaudeSessionContext,
    status: "completed" | "interrupted" | "failed",
    errorMessage?: string,
  ) => Effect.Effect<void>;
  readonly emitTrackedTasksUpdated: (
    context: ClaudeSessionContext,
    taskInput: { readonly toolUseId?: string; readonly rawPayload: unknown },
  ) => Effect.Effect<void>;
  readonly fileSystem: FileSystem.FileSystem;
  readonly makeEventStamp: () => Effect.Effect<Pick<ProviderRuntimeEvent, "eventId" | "createdAt">>;
  readonly nowIso: Effect.Effect<string>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly requireSession: (
    threadId: Parameters<ClaudeAdapterShape["hasSession"]>[0],
  ) => Effect.Effect<ClaudeSessionContext, ProviderAdapterError>;
  readonly resolveModelCapabilities: (
    modelDiscoveryKey: string,
    model: string | undefined,
  ) => ModelCapabilities;
  readonly snapshotThread: (
    context: ClaudeSessionContext,
  ) => ReturnType<ClaudeAdapterShape["readThread"]>;
  readonly stopSessionInternal: (
    context: ClaudeSessionContext,
    options?: { readonly emitExitEvent?: boolean },
  ) => Effect.Effect<void>;
  readonly updateResumeCursor: (context: ClaudeSessionContext) => Effect.Effect<void>;
  readonly withLifecycleLock: <A, E, R>(
    threadId: Parameters<ClaudeAdapterShape["hasSession"]>[0],
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}) {
  const startTurnWatchdog = (context: ClaudeSessionContext, turnId: TurnId): void => {
    const idleTimeoutMs = context.responseIdleTimeoutMs;
    const checkIntervalMs = Math.min(
      CLAUDE_TURN_WATCHDOG_MAX_INTERVAL_MS,
      Math.max(250, Math.floor(idleTimeoutMs / 4)),
    );
    const fiber = Effect.runFork(
      runTurnIdleWatchdog({
        idleTimeoutMs,
        checkIntervalMs,
        isTurnActive: () => !context.stopped && context.turnState?.turnId === turnId,
        isAwaitingHuman: () =>
          context.pendingApprovals.size > 0 || context.pendingUserInputs.size > 0,
        lastActivityAt: () => context.turnState?.lastActivityAt ?? Date.now(),
        touchActivity: () => {
          if (context.turnState?.turnId === turnId) {
            context.turnState.lastActivityAt = Date.now();
          }
        },
        onIdleTimeout: (idleMs) =>
          Effect.gen(function* () {
            if (context.turnState?.turnId !== turnId) return;
            context.turnWatchdogFiber = undefined;
            const idleMinutes = Math.max(1, Math.round(idleMs / 60_000));
            yield* input.completeTurn(
              context,
              "failed",
              `Claude produced no SDK activity for ${idleMinutes} minute${idleMinutes === 1 ? "" : "s"}.`,
            );
            yield* input.stopSessionInternal(context, { emitExitEvent: true });
          }),
      }),
    );
    context.turnWatchdogFiber = fiber;
  };

  const sendTurn: ClaudeAdapterShape["sendTurn"] = (turnInput) =>
    Effect.gen(function* () {
      const context = yield* input.requireSession(turnInput.threadId);
      const modelSelection =
        turnInput.modelSelection?.provider === PROVIDER ? turnInput.modelSelection : undefined;
      const selectedCapabilities = input.resolveModelCapabilities(
        context.modelDiscoveryKey,
        modelSelection?.model ?? context.currentApiModelId,
      );
      const requestedAutoCompactWindow = resolveSelectedClaudeAutoCompactWindow(
        modelSelection?.model,
        modelSelection?.options?.autoCompactWindow ?? modelSelection?.options?.contextWindow,
        selectedCapabilities,
      );

      if (context.turnState) {
        yield* input.completeTurn(context, "completed");
      }
      if (hasOnlyCompletedClaudeTasks(context.trackedTasks)) {
        context.trackedTasks.clear();
        yield* input.updateResumeCursor(context);
      }

      if (modelSelection?.model) {
        const apiModelId = resolveApiModelId(modelSelection);
        const reroutedFrom = context.rerouteOriginalApiModelId;
        const requestsReroutedModel =
          reroutedFrom !== undefined &&
          stripClaudeContextWindowSuffix(apiModelId) ===
            stripClaudeContextWindowSuffix(reroutedFrom);
        if (requestsReroutedModel) {
          const fallbackApiModelId = context.currentApiModelId;
          if (fallbackApiModelId !== undefined) {
            const effectiveFallbackApiModelId = stripClaudeContextWindowSuffix(fallbackApiModelId);
            context.currentApiModelId = effectiveFallbackApiModelId;
            context.lastKnownContextWindow = resolveClaudeApiModelIdContextWindowMaxTokens(
              effectiveFallbackApiModelId,
              input.resolveModelCapabilities(
                context.modelDiscoveryKey,
                effectiveFallbackApiModelId,
              ),
            );
            yield* input.updateResumeCursor(context);
          }
        } else {
          if (apiModelId !== context.currentApiModelId) {
            yield* Effect.tryPromise({
              try: () => context.query.setModel(apiModelId),
              catch: (cause) => toRequestError(turnInput.threadId, "turn/setModel", cause),
            });
          }
          context.currentApiModelId = apiModelId;
          context.rerouteOriginalApiModelId = undefined;
          context.lastKnownContextWindow =
            resolveClaudeApiModelIdContextWindowMaxTokens(
              apiModelId,
              input.resolveModelCapabilities(context.modelDiscoveryKey, apiModelId),
            );
          yield* input.updateResumeCursor(context);
        }
      }

      if (modelSelection && requestedAutoCompactWindow !== context.currentAutoCompactWindow) {
        yield* Effect.tryPromise({
          try: () =>
            context.query.applyFlagSettings({
              autoCompactWindow: requestedAutoCompactWindow ?? null,
            }),
          catch: (cause) => toRequestError(turnInput.threadId, "turn/applyFlagSettings", cause),
        });
        context.currentAutoCompactWindow = requestedAutoCompactWindow;
        context.lastKnownAutoCompactThreshold = requestedAutoCompactWindow;
        context.emittedContextUsageWarnings.delete("near-window");
        context.emittedContextUsageWarnings.delete("large-prompt");
      }

      const interactionMode = turnInput.interactionMode ?? "default";
      if (interactionMode === "plan") {
        yield* Effect.tryPromise({
          try: () => context.query.setPermissionMode("plan"),
          catch: (cause) => toRequestError(turnInput.threadId, "turn/setPermissionMode", cause),
        });
      } else if (
        context.basePermissionMode !== undefined ||
        context.lastInteractionMode === "plan"
      ) {
        yield* Effect.tryPromise({
          try: () => context.query.setPermissionMode(context.basePermissionMode ?? "default"),
          catch: (cause) => toRequestError(turnInput.threadId, "turn/setPermissionMode", cause),
        });
      }

      const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
      const turnState: ClaudeTurnState = {
        turnId,
        startedAt: yield* input.nowIso,
        interactionMode,
        items: [],
        assistantTextBlocks: new Map(),
        assistantTextBlockOrder: [],
        capturedProposedPlanKeys: new Set(),
        sawFileChange: false,
        lastActivityAt: Date.now(),
        nextSyntheticAssistantBlockIndex: -1,
      };
      const updatedAt = yield* input.nowIso;
      context.turnState = turnState;
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        updatedAt,
      };
      startTurnWatchdog(context, turnId);

      const startedStamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent({
        type: "turn.started",
        eventId: startedStamp.eventId,
        provider: PROVIDER,
        createdAt: startedStamp.createdAt,
        threadId: context.session.threadId,
        turnId,
        payload: context.currentApiModelId
          ? { model: stripClaudeContextWindowSuffix(context.currentApiModelId) }
          : modelSelection?.model
            ? { model: modelSelection.model }
            : {},
        providerRefs: {},
      });

      if (hasUnfinishedClaudeTasks(context.trackedTasks)) {
        yield* input.emitTrackedTasksUpdated(context, {
          rawPayload: {
            source: "claude.resume-cursor",
            trackedTaskCount: context.trackedTasks.size,
          },
        });
      }

      const message = yield* buildUserMessageEffect(turnInput, {
        fileSystem: input.fileSystem,
        attachmentsDir: input.attachmentsDir,
      });
      yield* Queue.offer(context.promptQueue, { type: "message", message }).pipe(
        Effect.mapError((cause) => toRequestError(turnInput.threadId, "turn/start", cause)),
      );
      return {
        threadId: context.session.threadId,
        turnId,
        ...(context.session.resumeCursor !== undefined
          ? { resumeCursor: context.session.resumeCursor }
          : {}),
      };
    });

  const interruptTurn: ClaudeAdapterShape["interruptTurn"] = (
    threadId,
    _turnId,
    providerThreadId,
  ) =>
    Effect.gen(function* () {
      const context = yield* input.requireSession(threadId);
      if (providerThreadId) {
        const decision = context.subagentRoutes.requestStop(providerThreadId);
        if (decision.kind !== "ready") return;
        yield* Effect.tryPromise({
          try: () => context.query.stopTask(decision.taskId),
          catch: (cause) => toRequestError(threadId, "turn/interrupt", cause),
        });
        return;
      }
      if (context.turnState) {
        context.interruptRequestedTurnId = context.turnState.turnId;
      }
      yield* Effect.tryPromise({
        try: () => context.query.interrupt(),
        catch: (cause) => toRequestError(threadId, "turn/interrupt", cause),
      });
    });

  const readThread: ClaudeAdapterShape["readThread"] = (threadId) =>
    Effect.flatMap(input.requireSession(threadId), input.snapshotThread);

  const rollbackThread: ClaudeAdapterShape["rollbackThread"] = (threadId, numTurns) =>
    Effect.gen(function* () {
      const context = yield* input.requireSession(threadId);
      context.turns.splice(Math.max(0, context.turns.length - numTurns));
      yield* input.updateResumeCursor(context);
      return yield* input.snapshotThread(context);
    });

  const respondToRequest: ClaudeAdapterShape["respondToRequest"] = (
    threadId,
    requestId,
    decision,
  ) =>
    Effect.gen(function* () {
      const context = yield* input.requireSession(threadId);
      const pending = context.pendingApprovals.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "item/requestApproval/decision",
          detail: `Unknown pending approval request: ${requestId}`,
        });
      }
      context.pendingApprovals.delete(requestId);
      yield* Deferred.succeed(pending.decision, decision);
    });

  const respondToUserInput: ClaudeAdapterShape["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    Effect.gen(function* () {
      const context = yield* input.requireSession(threadId);
      const pending = context.pendingUserInputs.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "item/tool/respondToUserInput",
          detail: `Unknown pending user-input request: ${requestId}`,
        });
      }
      context.pendingUserInputs.delete(requestId);
      yield* Deferred.succeed(pending.answers, answers);
    });

  const stopSession: ClaudeAdapterShape["stopSession"] = (threadId) =>
    input.withLifecycleLock(
      threadId,
      Effect.gen(function* () {
        const context = yield* input.requireSession(threadId);
        yield* input.stopSessionInternal(context, { emitExitEvent: true });
      }),
    );

  return {
    interruptTurn,
    readThread,
    respondToRequest,
    respondToUserInput,
    rollbackThread,
    sendTurn,
    stopSession,
  };
}
