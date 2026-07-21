import { type EventId, type ProviderRuntimeEvent, type ThreadId, TurnId } from "@agent-group/contracts";
import { Cause, Deferred, Effect, FileSystem, Option } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { appendFileAttachmentsPromptBlock } from "./attachmentProjection.ts";
import { appendProviderReferencesPromptBlock } from "./promptReferenceProjection.ts";
import { filterProviderPromptImageAttachments } from "./promptAttachments.ts";
import { classifyAcpPromptTurnCompletion, mapAcpToAdapterError } from "./acp/AcpAdapterSupport.ts";
import {
  settleAcpPendingApprovalsAsCancelled,
  settleAcpPendingUserInputsAsEmptyAnswers,
} from "./acp/AcpAdapterSessionSupport.ts";
import {
  applyDroidAcpInteractionMode,
  applyDroidAcpModelSelection,
} from "./acp/DroidAcpSupport.ts";
import { forkAcpTurnIdleWatchdog, resolveAcpTurnIdleTimeoutMs } from "./acp/AcpTurnIdleWatchdog.ts";
import {
  cancelDroidPromptWithGrace,
  waitForDroidQueuedTurnEventsDrained,
} from "./droidAdapterCoordination.ts";
import { DROID_ACP_REQUEST_TIMEOUT_MS, droidAcpTimeoutError } from "./droidAdapterLogging.ts";
import {
  clearDroidActiveTurn,
  type DroidSessionContext,
  finalizeDroidActiveTurnCost,
  shouldIgnoreDroidInterrupt,
  withDroidPlanModePrompt,
} from "./droidAdapterSessionState.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "./Errors.ts";
import type { DroidAdapterShape } from "./Services/DroidAdapter.ts";

const PROVIDER = "droid" as const;
const DROID_TURN_IDLE_TIMEOUT_MS = resolveAcpTurnIdleTimeoutMs({
  envVar: "AGENT_GROUP_DROID_TURN_IDLE_TIMEOUT_MS",
  defaultMs: 600_000,
});
const DROID_TURN_WATCHDOG_INTERVAL_MS = 15_000;
const DROID_NESTED_TASK_IDLE_TIMEOUT_MS = 60 * 60_000;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };
type StopSessionInternal = (
  ctx: DroidSessionContext,
  options?: {
    readonly exitKind?: "graceful" | "error";
    readonly reason?: string;
    readonly awaitTermination?: boolean;
  },
) => Effect.Effect<void>;

export function makeDroidTurnOperations(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly attachmentsDir: string;
  readonly nowIso: Effect.Effect<string>;
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly requireSession: (
    threadId: ThreadId,
  ) => Effect.Effect<DroidSessionContext, ProviderAdapterSessionNotFoundError>;
  readonly stopSessionInternal: StopSessionInternal;
}): Pick<DroidAdapterShape, "sendTurn" | "interruptTurn"> {
  const failTurnAsTimedOut = (ctx: DroidSessionContext, turnId: TurnId, idleMs: number) =>
    Effect.gen(function* () {
      const promptFiber = ctx.activePromptFiber;
      if (!clearDroidActiveTurn(ctx, turnId)) return;
      const completedCost = finalizeDroidActiveTurnCost(ctx);
      const idleSeconds = Math.round(idleMs / 1000);
      const detail = `Droid stopped responding (no activity for ${idleSeconds}s); the turn was timed out.`;
      ctx.turns.push({ id: turnId, items: [{ prompt: turnId, timedOut: true, idleMs }] });
      ctx.session = {
        ...ctx.session,
        status: "error",
        updatedAt: yield* input.nowIso,
        lastError: detail,
      };
      yield* Effect.logWarning("droid.acp.turn_idle_timeout", {
        threadId: ctx.threadId,
        turnId,
        idleMs,
      });
      yield* input.offerRuntimeEvent({
        type: "turn.completed",
        ...(yield* input.makeEventStamp()),
        provider: PROVIDER,
        threadId: ctx.threadId,
        turnId,
        payload: {
          state: "failed",
          stopReason: null,
          errorMessage: detail,
          ...completedCost,
        },
      });
      yield* cancelDroidPromptWithGrace(ctx, promptFiber);
      yield* input.stopSessionInternal(ctx, {
        exitKind: "error",
        reason: detail,
        awaitTermination: false,
      });
    });

  const startTurn = (
    ctx: DroidSessionContext,
    request: Parameters<DroidAdapterShape["sendTurn"]>[0],
  ) =>
    Effect.gen(function* () {
      if (ctx.sessionConfigReady !== undefined) yield* Deferred.await(ctx.sessionConfigReady);
      if (ctx.resumeReplayReady !== undefined) yield* Deferred.await(ctx.resumeReplayReady);
      if (ctx.stopped) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId: request.threadId,
        });
      }
      const turnId = TurnId.makeUnsafe(crypto.randomUUID());
      const turnModelSelection =
        request.modelSelection?.provider === PROVIDER ? request.modelSelection : undefined;
      const model = turnModelSelection?.model ?? ctx.session.model;
      yield* Effect.gen(function* () {
        if (model !== undefined) {
          yield* applyDroidAcpModelSelection({
            runtime: ctx.acp,
            model,
            reasoningEffort: turnModelSelection?.options?.reasoningEffort,
            mapError: ({ cause, method }) =>
              mapAcpToAdapterError(PROVIDER, request.threadId, method, cause),
          });
        }
        yield* applyDroidAcpInteractionMode({
          runtime: ctx.acp,
          ...(request.interactionMode !== undefined
            ? { interactionMode: request.interactionMode }
            : {}),
          runtimeMode: ctx.session.runtimeMode,
          mapError: ({ cause, method }) =>
            mapAcpToAdapterError(PROVIDER, request.threadId, method, cause),
        });
      }).pipe(
        Effect.timeoutOption(DROID_ACP_REQUEST_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(droidAcpTimeoutError("session/set_config_option")),
            onSome: Effect.succeed,
          }),
        ),
        Effect.onError((cause) =>
          input.stopSessionInternal(ctx, {
            exitKind: "error",
            reason: Cause.pretty(cause),
          }),
        ),
      );

      const promptParts: Array<EffectAcpSchema.ContentBlock> = [];
      const promptText = appendFileAttachmentsPromptBlock({
        text: appendProviderReferencesPromptBlock({
          text: request.input?.trim()
            ? withDroidPlanModePrompt({
                text: request.input.trim(),
                ...(request.interactionMode !== undefined
                  ? { interactionMode: request.interactionMode }
                  : {}),
              })
            : undefined,
          mentions: request.mentions,
        }),
        attachments: request.attachments,
        attachmentsDir: input.attachmentsDir,
        include: "all-files",
      });
      if (promptText) promptParts.push({ type: "text", text: promptText });
      if (request.attachments && request.attachments.length > 0) {
        for (const attachment of filterProviderPromptImageAttachments(request.attachments)) {
          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: input.attachmentsDir,
            attachment,
          });
          if (!attachmentPath) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/prompt",
              detail: `Invalid attachment id '${attachment.id}'.`,
            });
          }
          const bytes = yield* input.fileSystem.readFile(attachmentPath).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/prompt",
                  detail: cause.message,
                  cause,
                }),
            ),
          );
          promptParts.push({
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: attachment.mimeType,
          });
        }
      }
      if (promptParts.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Turn requires non-empty text or attachments.",
        });
      }
      if (ctx.stopped) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId: request.threadId,
        });
      }
      ctx.activeTurnId = turnId;
      ctx.activeTurnHadAssistantContent = false;
      ctx.activeAssistantItemsWithContent.clear();
      ctx.activeTurnFailedToolDetail = undefined;
      ctx.turnToolCallIds.clear();
      ctx.activeNestedTaskToolCallIds.clear();
      ctx.nestedTaskLifecycleByToolCallId.clear();
      ctx.activeInteractionMode = request.interactionMode;
      ctx.lastPlanFingerprint = undefined;
      ctx.lastTurnActivityAt = Date.now();
      const { lastError: _lastError, ...sessionWithoutLastError } = ctx.session;
      ctx.session = {
        ...sessionWithoutLastError,
        status: "running",
        activeTurnId: turnId,
        updatedAt: yield* input.nowIso,
      };
      yield* input.offerRuntimeEvent({
        type: "turn.started",
        ...(yield* input.makeEventStamp()),
        provider: PROVIDER,
        threadId: request.threadId,
        turnId,
        payload: { ...(model ? { model } : {}) },
      });

      const runPrompt = Effect.suspend(() =>
        ctx.pendingTurnInterrupted || ctx.stopped
          ? Effect.interrupt
          : ctx.acp.prompt({ prompt: promptParts }),
      ).pipe(
        Effect.mapError((error) =>
          mapAcpToAdapterError(PROVIDER, request.threadId, "session/prompt", error),
        ),
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.gen(function* () {
              yield* waitForDroidQueuedTurnEventsDrained(ctx);
              if (!clearDroidActiveTurn(ctx, turnId)) return;
              const completedCost = finalizeDroidActiveTurnCost(ctx);
              ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, error }] });
              const detail = error.message;
              ctx.session = {
                ...ctx.session,
                status: "error",
                updatedAt: yield* input.nowIso,
                ...(model ? { model } : {}),
                lastError: detail,
              };
              yield* input.offerRuntimeEvent({
                type: "turn.completed",
                ...(yield* input.makeEventStamp()),
                provider: PROVIDER,
                threadId: request.threadId,
                turnId,
                payload: {
                  state: "failed",
                  stopReason: null,
                  errorMessage: detail,
                  ...completedCost,
                },
              });
              yield* input.stopSessionInternal(ctx, {
                exitKind: "error",
                reason: detail,
                awaitTermination: false,
              });
            }),
          onSuccess: (result) =>
            Effect.gen(function* () {
              yield* waitForDroidQueuedTurnEventsDrained(ctx);
              const hadAssistantContent = ctx.activeTurnHadAssistantContent;
              const failedToolDetail = ctx.activeTurnFailedToolDetail;
              if (!clearDroidActiveTurn(ctx, turnId)) return;
              const completedCost = finalizeDroidActiveTurnCost(ctx);
              ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, result }] });
              const { lastError: _lastError, ...sessionWithoutLastError } = ctx.session;
              ctx.session = {
                ...sessionWithoutLastError,
                status: "ready",
                updatedAt: yield* input.nowIso,
                ...(model ? { model } : {}),
              };
              if (!hadAssistantContent && result.stopReason !== "cancelled") {
                yield* Effect.logWarning("droid.acp.turn_completed_without_content", {
                  threadId: request.threadId,
                  turnId,
                  stopReason: result.stopReason ?? null,
                  hasUsage: result.usage !== undefined,
                });
              }
              const completion = classifyAcpPromptTurnCompletion({
                stopReason: result.stopReason,
                ...(failedToolDetail !== undefined ? { failedToolDetail } : {}),
              });
              yield* input.offerRuntimeEvent({
                type: "turn.completed",
                ...(yield* input.makeEventStamp()),
                provider: PROVIDER,
                threadId: request.threadId,
                turnId,
                payload: {
                  state: completion.state,
                  stopReason: result.stopReason ?? null,
                  ...(completion.errorMessage !== undefined
                    ? { errorMessage: completion.errorMessage }
                    : {}),
                  ...(result.usage ? { usage: result.usage } : {}),
                  ...completedCost,
                },
              });
            }),
        }),
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            if (!clearDroidActiveTurn(ctx, turnId)) return;
            const completedCost = finalizeDroidActiveTurnCost(ctx);
            ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, interrupted: true }] });
            const { lastError: _lastError, ...sessionWithoutLastError } = ctx.session;
            ctx.session = {
              ...sessionWithoutLastError,
              status: "ready",
              updatedAt: yield* input.nowIso,
              ...(model ? { model } : {}),
            };
            yield* input.offerRuntimeEvent({
              type: "turn.completed",
              ...(yield* input.makeEventStamp()),
              provider: PROVIDER,
              threadId: request.threadId,
              turnId,
              payload: { state: "cancelled", stopReason: "cancelled", ...completedCost },
            });
          }),
        ),
        Effect.ignoreCause({ log: true }),
        Effect.forkIn(ctx.scope),
      );
      ctx.activePromptFiber = yield* runPrompt;
      yield* forkAcpTurnIdleWatchdog({
        idleTimeoutMs: DROID_TURN_IDLE_TIMEOUT_MS,
        currentIdleTimeoutMs: () =>
          ctx.activeNestedTaskToolCallIds.size > 0
            ? DROID_NESTED_TASK_IDLE_TIMEOUT_MS
            : DROID_TURN_IDLE_TIMEOUT_MS,
        checkIntervalMs: DROID_TURN_WATCHDOG_INTERVAL_MS,
        scope: ctx.scope,
        isTurnActive: () => ctx.activeTurnId === turnId && !ctx.stopped,
        isAwaitingHuman: () => ctx.pendingApprovals.size > 0 || ctx.pendingUserInputs.size > 0,
        lastActivityAt: () => ctx.lastTurnActivityAt ?? Date.now(),
        touchActivity: () => {
          ctx.lastTurnActivityAt = Date.now();
        },
        onIdleTimeout: (idleMs) => failTurnAsTimedOut(ctx, turnId, idleMs),
      });
      return {
        threadId: request.threadId,
        turnId,
        ...(ctx.session.resumeCursor !== undefined
          ? { resumeCursor: ctx.session.resumeCursor }
          : {}),
      };
    });

  const sendTurn: DroidAdapterShape["sendTurn"] = (request) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(request.threadId);
      if (ctx.turnStarting) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Another Droid turn is still starting for this thread.",
        });
      }
      ctx.turnStarting = true;
      ctx.pendingTurnInterrupted = false;
      return yield* startTurn(ctx, request).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            ctx.turnStarting = false;
          }),
        ),
      );
    });

  const interruptTurn: DroidAdapterShape["interruptTurn"] = (threadId, turnId) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(threadId);
      if (shouldIgnoreDroidInterrupt(turnId, ctx.activeTurnId)) {
        yield* Effect.logWarning("droid.acp.stale_interrupt_ignored", {
          threadId,
          requestedTurnId: turnId,
          activeTurnId: ctx.activeTurnId,
        });
        return;
      }
      if (!ctx.turnStarting && ctx.activeTurnId === undefined) return;
      if (ctx.turnStarting && ctx.activePromptFiber === undefined) {
        ctx.pendingTurnInterrupted = true;
      }
      yield* settleAcpPendingApprovalsAsCancelled(ctx.pendingApprovals);
      yield* settleAcpPendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
      yield* cancelDroidPromptWithGrace(ctx, ctx.activePromptFiber);
      yield* input.stopSessionInternal(ctx, {
        exitKind: "graceful",
        reason: "Droid turn cancelled; runtime closed to stop nested work.",
      });
    });

  return { sendTurn, interruptTurn };
}
